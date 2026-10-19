/**
 * Lê os e-mails que chegam em ana@angisaude.com e transforma os que trazem
 * compromisso (reunião, treinamento, visita, consulta…) em compromissos da agenda.
 * Cada e-mail é analisado uma vez só (tabela email_scanned).
 */
const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const TARGET = "ana@angisaude.com";

function hdr(connKey: string) {
  return {
    Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": connKey,
  };
}

async function angiKey(): Promise<string | null> {
  const keys = Object.entries(process.env)
    .filter(([k, v]) => /^GOOGLE_MAIL_API_KEY(_\d+)?$/.test(k) && v)
    .map(([, v]) => v as string);
  for (const k of keys) {
    const r = await fetch(`${GATEWAY}/users/me/profile`, { headers: hdr(k) });
    if (!r.ok) continue;
    const j = (await r.json()) as { emailAddress?: string };
    if ((j.emailAddress ?? "").toLowerCase() === TARGET) return k;
  }
  return null;
}

function b64(data: string) {
  try {
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}
function collect(part: any, out: string[]) {
  if (!part) return;
  if (part.body?.data && /text\/(plain|html)/.test(part.mimeType ?? "")) out.push(b64(part.body.data));
  for (const p of part.parts ?? []) collect(p, out);
}
const strip = (s: string) =>
  s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function runEmailAppointments(supabase: any) {
  const key = await angiKey();
  if (!key) return { skipped: "no_mailbox" as const, created: 0 };

  const q = encodeURIComponent("in:inbox newer_than:7d -category:promotions -category:social");
  const lr = await fetch(`${GATEWAY}/users/me/messages?maxResults=30&q=${q}`, { headers: hdr(key) });
  if (!lr.ok) throw new Error(`Gmail [${lr.status}]: ${(await lr.text()).slice(0, 200)}`);
  const ids: string[] = (((await lr.json()) as any).messages ?? []).map((m: any) => m.id);
  if (!ids.length) return { created: 0 };

  const { data: done } = await supabase.from("email_scanned").select("message_id").in("message_id", ids);
  const seen = new Set((done ?? []).map((d: any) => d.message_id));
  const fresh = ids.filter((id) => !seen.has(id)).slice(0, 15);
  if (!fresh.length) return { created: 0 };

  const emails = (
    await Promise.all(
      fresh.map(async (id) => {
        const r = await fetch(`${GATEWAY}/users/me/messages/${id}?format=full`, { headers: hdr(key) });
        if (!r.ok) return null;
        const m = (await r.json()) as any;
        const h = (n: string) =>
          m.payload?.headers?.find((x: any) => x.name?.toLowerCase() === n)?.value ?? "";
        const parts: string[] = [];
        collect(m.payload, parts);
        return {
          id,
          from: h("from"),
          subject: h("subject"),
          date: h("date"),
          body: strip(parts.join(" ")).slice(0, 3000),
        };
      }),
    )
  ).filter(Boolean) as { id: string; from: string; subject: string; date: string; body: string }[];

  const { aiChat, hasAiProvider } = await import("./ai-fallback.server");
  if (!hasAiProvider()) return { created: 0, skipped: "no_ai" as const };

  const today = new Date().toISOString().slice(0, 10);
  const res = await aiChat({
    model: "google/gemini-3.8-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `Hoje é ${today}. Fuso: America/Sao_Paulo (-03:00).`,
          "Você lê e-mails e identifica COMPROMISSOS com data marcada: reuniões, convites de agenda, treinamentos, visitas, consultas, eventos, entregas com horário.",
          "Ignore propaganda, newsletters e e-mails sem data concreta. Use só datas futuras ou de hoje.",
          'Responda JSON: {"items":[{"id":"<id do email>","title":"título curto pt-BR","starts_at":"YYYY-MM-DDTHH:MM:00-03:00","duration_min":60,"is_meeting":true,"location":"ou null","link":"link de videochamada ou null"}]}',
          "Se não houver horário, use 09:00. Nunca invente ids.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(emails) },
    ],
  });

  let items: any[] = [];
  if (res.ok) {
    try {
      const j = (await res.json()) as any;
      items = JSON.parse(j.choices?.[0]?.message?.content ?? "{}").items ?? [];
    } catch {
      items = [];
    }
  }

  const valid = new Set(fresh);
  let created = 0;
  for (const it of items) {
    if (!it || !valid.has(it.id) || !it.title || !it.starts_at) continue;
    const start = new Date(it.starts_at);
    if (isNaN(start.getTime())) continue;
    const dur = Math.min(480, Math.max(15, Number(it.duration_min) || 60));
    const src = emails.find((e) => e.id === it.id);
    const { error } = await supabase.from("meetings").insert({
      title: String(it.title).slice(0, 200),
      source: "angi",
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + dur * 60000).toISOString(),
      location: it.location || null,
      is_meeting: it.is_meeting !== false,
      meeting_type: "email",
      people: src?.from ?? null,
      notes: `Criado a partir do e-mail: ${src?.subject ?? ""}\nhttps://mail.google.com/mail/u/0/#inbox/${it.id}`,
      external_url: it.link || `https://mail.google.com/mail/u/0/#inbox/${it.id}`,
    });
    if (!error) created++;
  }

  await supabase.from("email_scanned").upsert(fresh.map((message_id) => ({ message_id })), {
    onConflict: "message_id",
    ignoreDuplicates: true,
  });
  return { created };
}
