/**
 * Sync bilateral Notion (Devore) ↔ LUCK.
 * - Traz páginas de todos os databases compartilhados com a integração Notion.
 * - Insere/atualiza em public.tasks (source='devore', external_system='notion').
 * - LUCK concluída → Notion Concluída.
 */
import { listMyPages, transitionPage } from "./notion.server";

export async function runNotionSync(supabase: any, userId: string) {
  if (!process.env.LOVABLE_API_KEY || !process.env.NOTION_API_KEY) {
    return { imported: 0, pushed: 0, skipped: "sem credenciais" };
  }

  const allPages = await listMyPages();
  // Nunca importar páginas concluídas do Notion — só "a fazer" / "em execução" / "on hold".
  const pages = allPages.filter((p) => p.status !== "done");

  // Cutoff: só importa páginas do Notion CRIADAS a partir daqui.
  // Páginas antigas que foram apagadas manualmente na LUCK não devem voltar.
  const IMPORT_CUTOFF_ISO = "2026-07-26T22:00:00.000Z";


  const { data: existing } = await supabase
    .from("tasks")
    .select("id, external_id, status, locally_managed")
    .eq("external_system", "notion");

  const byKey = new Map<string, any>();
  for (const t of existing ?? []) if (t.external_id) byKey.set(t.external_id, t);

  const nowIso = new Date().toISOString();

  // LUCK → Notion: LUCK é a fonte da verdade de STATUS.
  // Se o status local diverge do Notion, empurra o local para o Notion.
  let pushed = 0;
  for (const p of allPages) {
    const local = byKey.get(p.pageId);
    if (!local) continue;
    if (local.status && local.status !== p.status) {
      try {
        const ok = await transitionPage(p.pageId, local.status as any);
        if (ok) pushed += 1;
      } catch {
        /* segue */
      }
    }
  }

  // Se a página virou "concluída" no Notion, remover da LUCK
  const remoteDoneIds = allPages
    .filter((p) => p.status === "done")
    .filter((p) => {
      const local = byKey.get(p.pageId);
      // só remove se o local também estava done (ou não existe)
      return !local || local.status === "done";
    })
    .map((p) => p.pageId);
  if (remoteDoneIds.length > 0) {
    await supabase
      .from("tasks")
      .delete()
      .eq("external_system", "notion")
      .in("external_id", remoteDoneIds);
  }

  // Notion → LUCK: upsert (só não-concluídas)
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
    _created: p.created,
  }));

  // Só insere páginas criadas no Notion a partir do cutoff.
  const toInsert = rows
    .filter((r) => !byKey.has(r.external_id) && r._created >= IMPORT_CUTOFF_ISO)
    .map(({ _created, ...rest }) => rest);
  const toUpdate = rows
    .filter((r) => byKey.has(r.external_id))
    .map(({ _created, ...rest }) => rest);

  if (toInsert.length > 0) {
    for (const r of toInsert) {
      const { error } = await supabase.from("tasks").insert(r);
      if (error) {
        // Se outra sincronização já criou a mesma página, atualiza a existente
        // em vez de recriar duplicada para outro login ativo.
        if (/duplicate key|unique/i.test(error.message)) {
          const { error: updateError } = await supabase
            .from("tasks")
            .update({
              priority: r.priority,
              external_url: r.external_url,
              updated_at: r.updated_at,
            })
            .eq("external_system", "notion")
            .eq("external_id", r.external_id);
          if (updateError) throw new Error(`Falha ao atualizar página Notion ${r.external_id}: ${updateError.message}`);
          continue;
        }
        throw new Error(`Falha ao inserir tarefas do Notion: ${error.message}`);
      }
    }
  }
  for (const r of toUpdate) {
    const local = byKey.get(r.external_id);
    // Depois de importada, nome e data pertencem ao LUCK — o Notion não reescreve.
    const { error } = await supabase
      .from("tasks")
      .update({
        priority: r.priority,
        external_url: r.external_url,
        updated_at: r.updated_at,
      })
      .eq("id", local.id);
    if (error) throw new Error(`Falha ao atualizar página Notion ${r.external_id}: ${error.message}`);
  }


  return { imported: rows.length, pushed };
}

