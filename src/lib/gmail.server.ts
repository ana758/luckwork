/**
 * Server-only Gmail access through Lovable connector gateway.
 * Uses the GOOGLE_MAIL connectors linked to the workspace.
 *
 * IMPORTANTE: a caixa pessoal anaduquek@gmail.com NÃO é analisada
 * (a agenda dela continua conectada normalmente).
 */

const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

/** Contas cujo e-mail não deve ser lido/analisado pela LUCK. */
export const EXCLUDED_MAIL_ACCOUNTS = ["anaduquek@gmail.com"];

function headersFor(connKey: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada.");
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

const accountEmailCache = new Map<string, string>();

function allGmailKeys(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => /^GOOGLE_MAIL_API_KEY(_\d+)?$/.test(k) && typeof v === "string" && v)
    .map(([, v]) => v as string);
}

async function accountEmail(connKey: string): Promise<string> {
  const cached = accountEmailCache.get(connKey);
  if (cached) return cached;
  try {
    const r = await fetch(`${GATEWAY}/users/me/profile`, { headers: headersFor(connKey) });
    if (!r.ok) return "";
    const j = (await r.json()) as { emailAddress?: string };
    const email = (j.emailAddress ?? "").toLowerCase();
    if (email) accountEmailCache.set(connKey, email);
    return email;
  } catch {
    return "";
  }
}

/** Conexões de Gmail que podem ser lidas (exclui as contas bloqueadas). */
export async function readableGmailKeys(): Promise<string[]> {
  const keys = allGmailKeys();
  const out: string[] = [];
  for (const k of keys) {
    const email = await accountEmail(k);
    if (email && EXCLUDED_MAIL_ACCOUNTS.includes(email)) continue;
    out.push(k);
  }
  return out;
}

export async function hasReadableGmail(): Promise<boolean> {
  return (await readableGmailKeys()).length > 0;
}


export type GmailPreview = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  link: string;
};

function headerValue(headers: { name?: string; value?: string }[] | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  return { name: raw.trim(), email: raw.trim().toLowerCase() };
}

/**
 * Fetches recent inbox messages (default: last 40, unread OR received in the last 2 days).
 * Returns concise previews suitable for AI classification.
 */
export async function fetchRecentInbox(limit = 40): Promise<GmailPreview[]> {
  // Only inbox, not promotions/social/updates/forums, last 3 days
  const q = encodeURIComponent(
    "in:inbox -category:promotions -category:social -category:updates -category:forums newer_than:3d",
  );
  const listRes = await fetch(
    `${GATEWAY}/users/me/messages?maxResults=${limit}&q=${q}`,
    { headers: headers() },
  );
  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Gmail list falhou [${listRes.status}]: ${body.slice(0, 300)}`);
  }
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).slice(0, limit).map((m) => m.id);
  if (ids.length === 0) return [];

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const r = await fetch(
        `${GATEWAY}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: headers() },
      );
      if (!r.ok) throw new Error(String(r.status));
      const msg = (await r.json()) as {
        id: string;
        snippet?: string;
        labelIds?: string[];
        payload?: { headers?: { name?: string; value?: string }[] };
        internalDate?: string;
      };
      const hdrs = msg.payload?.headers;
      const from = parseFrom(headerValue(hdrs, "From"));
      const subject = headerValue(hdrs, "Subject") || "(sem assunto)";
      const dateHdr = headerValue(hdrs, "Date");
      const date = dateHdr || (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "");
      return {
        id: msg.id,
        from: from.name,
        fromEmail: from.email,
        subject,
        snippet: (msg.snippet ?? "").slice(0, 240),
        date,
        unread: (msg.labelIds ?? []).includes("UNREAD"),
        link: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
      } satisfies GmailPreview;
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<GmailPreview> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Uses the AI gateway to filter promotional / spam / newsletter noise
 * and return only messages that look important (legal, personal, work asks, etc).
 */
export async function classifyImportantEmails(
  emails: GmailPreview[],
): Promise<{ id: string; reason: string; category: string }[]> {
  if (emails.length === 0) return [];
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada.");

  const compact = emails.map((e) => ({
    id: e.id,
    from: `${e.from} <${e.fromEmail}>`,
    subject: e.subject,
    snippet: e.snippet,
  }));

  const system = [
    "Você classifica e-mails de uma executiva. Marque como IMPORTANTE apenas mensagens que exigem atenção humana:",
    "- assuntos jurídicos / justiça / contratos / notificações fiscais",
    "- pedidos ou perguntas diretas de pessoas reais (clientes, fornecedores, colegas, família)",
    "- reuniões, prazos, cobranças, faturas em aberto",
    "- oportunidades de trabalho, propostas comerciais direcionadas",
    "IGNORE (não é importante): promoções, propaganda, cupom, newsletter, marketing, lojas, notificações automáticas de app, redes sociais, resumos, updates de produto.",
    "Responda APENAS JSON válido no formato:",
    `{"important":[{"id":"<id do email>","category":"juridico|pessoal|trabalho|financeiro|outro","reason":"por que é importante em 1 frase curta pt-BR"}]}`,
    "Se nenhum for importante, retorne {\"important\":[]}. Nunca invente ids.",
  ].join("\n");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(compact) },
      ],
    }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  try {
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
    const list = Array.isArray(parsed.important) ? parsed.important : [];
    const validIds = new Set(emails.map((e) => e.id));
    return list
      .filter((x: any) => x && typeof x.id === "string" && validIds.has(x.id))
      .map((x: any) => ({
        id: String(x.id),
        reason: String(x.reason ?? ""),
        category: String(x.category ?? "outro"),
      }));
  } catch {
    return [];
  }
}

const MEETING_LINK_RE =
  /(https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[a-z0-9.-]*zoom\.us\/j\/[^\s"'<>)]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>)]+|[a-z0-9-]+\.whereby\.com\/[^\s"'<>)]+))/i;

function decodeB64Url(data: string): string {
  try {
    const b = data.replace(/-/g, "+").replace(/_/g, "/");
    return typeof atob === "function" ? atob(b) : Buffer.from(b, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function collectText(part: any, out: string[]) {
  if (!part) return;
  if (part.body?.data) out.push(decodeB64Url(part.body.data));
  for (const p of part.parts ?? []) collectText(p, out);
}

/**
 * Procura no Gmail o link da videochamada de uma reunião (Meet, Zoom, Teams, Whereby).
 * Busca por palavras do título nos últimos 60 dias e devolve o primeiro link encontrado.
 */
export async function findMeetingLink(title: string): Promise<string | null> {
  const words = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4);
  if (words.length === 0) return null;

  const q = encodeURIComponent(`newer_than:60d (${words.join(" ")})`);
  const listRes = await fetch(`${GATEWAY}/users/me/messages?maxResults=5&q=${q}`, {
    headers: headers(),
  });
  if (!listRes.ok) return null;
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  for (const m of list.messages ?? []) {
    const r = await fetch(`${GATEWAY}/users/me/messages/${m.id}?format=full`, {
      headers: headers(),
    });
    if (!r.ok) continue;
    const msg = (await r.json()) as { snippet?: string; payload?: any };
    const chunks: string[] = [msg.snippet ?? ""];
    collectText(msg.payload, chunks);
    const found = chunks.join("\n").match(MEETING_LINK_RE);
    if (found) return found[1];
  }
  return null;
}
