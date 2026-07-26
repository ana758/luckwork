/**
 * Cliente Notion via connector gateway da Lovable.
 * Traz páginas de todos os databases compartilhados com a integração
 * e considera tudo como Devore (source='devore', external_system='notion').
 *
 * Bilateral: mover a tarefa no Anora → PATCH nas propriedades da página
 * para o Status equivalente. Se a página tiver pessoas em "Proprietário"
 * (ou property similar), filtra por Ana quando possível.
 */

const GATEWAY = "https://connector-gateway.lovable.dev/notion/v1";

function headers() {
  const lov = process.env.LOVABLE_API_KEY;
  const key = process.env.NOTION_API_KEY;
  if (!lov || !key) throw new Error("Notion não configurado (LOVABLE_API_KEY / NOTION_API_KEY).");
  return {
    Authorization: `Bearer ${lov}`,
    "X-Connection-Api-Key": key,
    "Content-Type": "application/json",
  };
}

async function notionFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

export type NotionTask = {
  pageId: string;
  url: string;
  title: string;
  status: "todo" | "doing" | "onhold" | "done";
  priority: "alta" | "media" | "baixa";
  dueDate: string | null;
  updated: string;
};

function pickTitle(props: Record<string, any>): string {
  for (const v of Object.values(props)) {
    if ((v as any)?.type === "title") {
      const parts = (v as any).title as { plain_text: string }[];
      return parts.map((p) => p.plain_text).join("").trim() || "(sem título)";
    }
  }
  return "(sem título)";
}

function mapStatus(name: string): "todo" | "doing" | "done" | "onhold" {
  const n = (name ?? "").toLowerCase();
  if (/conclu|complete|done|finaliz|resolv/.test(n)) return "done";
  if (/hold|paus|aguard|review|revis/.test(n)) return "onhold";
  if (/execu|progress|andamento|doing|working/.test(n)) return "doing";
  return "todo";
}

function findStatus(props: Record<string, any>): { name: string; propName: string } | null {
  for (const [name, v] of Object.entries(props)) {
    const t = (v as any)?.type;
    if (t === "status" && (v as any).status?.name) return { name: (v as any).status.name, propName: name };
    if (t === "select" && (v as any).select?.name) return { name: (v as any).select.name, propName: name };
  }
  return null;
}

function findDate(props: Record<string, any>): string | null {
  for (const v of Object.values(props)) {
    if ((v as any)?.type === "date" && (v as any).date?.start) {
      return String((v as any).date.start).slice(0, 10);
    }
  }
  return null;
}

function findPriority(props: Record<string, any>): "alta" | "media" | "baixa" {
  for (const [name, v] of Object.entries(props)) {
    if (!/prio|priori/i.test(name)) continue;
    const t = (v as any)?.type;
    const val: string =
      t === "select"
        ? (v as any).select?.name ?? ""
        : t === "status"
          ? (v as any).status?.name ?? ""
          : "";
    const n = val.toLowerCase();
    if (/p0|alta|high|urgent/.test(n)) return "alta";
    if (/p3|baixa|low/.test(n)) return "baixa";
    if (n) return "media";
  }
  return "media";
}

async function listDatabases(): Promise<string[]> {
  const ids: string[] = [];
  let start: string | undefined;
  for (let i = 0; i < 5; i++) {
    const body: Record<string, unknown> = {
      filter: { value: "database", property: "object" },
      page_size: 100,
    };
    if (start) body.start_cursor = start;
    const data = await notionFetch(`/search`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    for (const r of data.results ?? []) ids.push(r.id);
    if (!data.has_more) break;
    start = data.next_cursor;
  }
  return ids;
}

async function queryDatabase(dbId: string): Promise<any[]> {
  const out: any[] = [];
  let start: string | undefined;
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (start) body.start_cursor = start;
    const data = await notionFetch(`/databases/${dbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    for (const r of data.results ?? []) out.push(r);
    if (!data.has_more) break;
    start = data.next_cursor;
  }
  return out;
}

/** Lista todas as páginas de todos os databases acessíveis. */
export async function listMyPages(): Promise<NotionTask[]> {
  const dbs = await listDatabases();
  const pages: any[] = [];
  for (const db of dbs) {
    try {
      const rows = await queryDatabase(db);
      pages.push(...rows);
    } catch {
      // segue — algum database pode falhar sem quebrar o resto
    }
  }
  const out: NotionTask[] = [];
  for (const p of pages) {
    if (p.archived) continue;
    const props = p.properties ?? {};
    const st = findStatus(props);
    out.push({
      pageId: p.id,
      url: p.url,
      title: pickTitle(props),
      status: st ? (mapStatus(st.name) as NotionTask["status"]) : "todo",
      priority: findPriority(props),
      dueDate: findDate(props),
      updated: p.last_edited_time ?? new Date().toISOString(),
    });
  }
  return out;
}

/** Move a página Notion para o status equivalente (só se houver property status/select). */
export async function transitionPage(
  pageId: string,
  target: "todo" | "doing" | "onhold" | "done",
): Promise<boolean> {
  const page: any = await notionFetch(`/pages/${pageId}`);
  const props = page.properties ?? {};
  // Localiza property e opção compatível
  for (const [propName, v] of Object.entries(props)) {
    const t = (v as any)?.type;
    if (t !== "status" && t !== "select") continue;
    // Pega opções da database
    const dbId = page.parent?.database_id;
    if (!dbId) continue;
    const db: any = await notionFetch(`/databases/${dbId}`);
    const meta = db.properties?.[propName];
    const options: { id: string; name: string }[] =
      meta?.status?.options ?? meta?.select?.options ?? [];
    const pick = options.find((o) => {
      const n = o.name.toLowerCase();
      if (target === "done") return /conclu|complete|done|finaliz|resolv/.test(n);
      if (target === "onhold") return /hold|paus|aguard|review|revis/.test(n);
      if (target === "doing") return /execu|progress|andamento|doing|working/.test(n);
      return /não|nao|iniciad|to.?do|a fazer|backlog|novo|open/.test(n);
    });
    if (!pick) continue;
    const body: Record<string, unknown> = {
      properties: {
        [propName]: t === "status" ? { status: { name: pick.name } } : { select: { name: pick.name } },
      },
    };
    await notionFetch(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return true;
  }
  return false;
}
