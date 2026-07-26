/**
 * Sync bilateral Notion (Devore) ↔ Anora.
 * - Traz páginas de todos os databases compartilhados com a integração Notion.
 * - Insere/atualiza em public.tasks (source='devore', external_system='notion').
 * - Anora concluída → Notion Concluída.
 */
import { listMyPages, transitionPage } from "./notion.server";

export async function runNotionSync(supabase: any, userId: string) {
  if (!process.env.LOVABLE_API_KEY || !process.env.NOTION_API_KEY) {
    return { imported: 0, pushed: 0, skipped: "sem credenciais" };
  }

  const allPages = await listMyPages();
  // Nunca importar páginas concluídas do Notion — só "a fazer" / "em execução" / "on hold".
  const pages = allPages.filter((p) => p.status !== "done");

  const { data: existing } = await supabase
    .from("tasks")
    .select("id, external_id, status")
    .eq("created_by", userId)
    .eq("external_system", "notion");

  const byKey = new Map<string, any>();
  for (const t of existing ?? []) if (t.external_id) byKey.set(t.external_id, t);

  const nowIso = new Date().toISOString();

  // Anora → Notion: se concluída aqui e não lá, mover
  let pushed = 0;
  for (const p of allPages) {
    const local = byKey.get(p.pageId);
    if (!local) continue;
    if (local.status === "done" && p.status !== "done") {
      try {
        const ok = await transitionPage(p.pageId, "done");
        if (ok) pushed += 1;
      } catch {
        /* segue */
      }
    }
  }

  // Se a página virou "concluída" no Notion, remover da Anora
  const remoteDoneIds = allPages.filter((p) => p.status === "done").map((p) => p.pageId);
  if (remoteDoneIds.length > 0) {
    await supabase
      .from("tasks")
      .delete()
      .eq("created_by", userId)
      .eq("external_system", "notion")
      .in("external_id", remoteDoneIds);
  }

  // Notion → Anora: upsert (só não-concluídas)
  const rows = pages.map((p) => ({
    created_by: userId,
    source: "devore" as const,
    external_system: "notion" as const,
    external_id: p.pageId,
    external_url: p.url,
    title: p.title,
    status: p.status,
    priority: p.priority,
    due_date: p.dueDate,
    completed_at: null,
    updated_at: nowIso,
  }));

  const toInsert = rows.filter((r) => !byKey.has(r.external_id));
  const toUpdate = rows.filter((r) => byKey.has(r.external_id));

  if (toInsert.length > 0) {
    const { error } = await supabase.from("tasks").insert(toInsert);
    if (error) throw new Error(`Falha ao inserir tarefas do Notion: ${error.message}`);
  }
  for (const r of toUpdate) {
    const local = byKey.get(r.external_id);
    const { error } = await supabase
      .from("tasks")
      .update({
        title: r.title,
        status: r.status,
        priority: r.priority,
        due_date: r.due_date,
        completed_at: r.completed_at,
        external_url: r.external_url,
        updated_at: r.updated_at,
      })
      .eq("id", local.id);
    if (error) throw new Error(`Falha ao atualizar página Notion ${r.external_id}: ${error.message}`);
  }

  return { imported: rows.length, pushed };
}
