/**
 * Sync bilateral Jira ↔ Anora.
 * - Traz issues do projeto TASK atribuídas ao usuário do token.
 * - Insere/atualiza em public.tasks (source = 'angi', external_system = 'jira').
 * - Se a issue foi concluída no Jira, marca a tarefa como done.
 * - Se a tarefa foi concluída no Anora, transiciona a issue para "Done".
 */
import { listMyIssues, transitionToDone, mapPriority, mapStatus } from "./jira.server";

export async function runJiraSync(supabase: any, userId: string) {
  if (!process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    return { imported: 0, pushed: 0, skipped: "sem credenciais" };
  }

  const issues = await listMyIssues();

  // Tarefas existentes vindas do Jira (para este usuário)
  const { data: existing } = await supabase
    .from("tasks")
    .select("id, external_id, status, completed_at")
    .eq("created_by", userId)
    .eq("external_system", "jira");

  const byKey = new Map<string, any>();
  for (const t of existing ?? []) if (t.external_id) byKey.set(t.external_id, t);

  const nowIso = new Date().toISOString();

  // 1) Anora → Jira: issues que foram marcadas como done aqui, mas não estão done no Jira
  let pushed = 0;
  for (const iss of issues) {
    const local = byKey.get(iss.key);
    if (!local) continue;
    if (local.status === "done" && iss.statusCategory !== "done") {
      try {
        const ok = await transitionToDone(iss.key);
        if (ok) pushed += 1;
      } catch {
        // segue o baile — não interrompe o sync
      }
    }
  }

  // 2) Jira → Anora: upsert de cada issue
  const rows = issues.map((iss) => ({
    created_by: userId,
    source: "angi" as const,
    external_system: "jira" as const,
    external_id: iss.key,
    external_url: iss.url,
    title: `[${iss.key}] ${iss.summary}`,
    status: mapStatus(iss.statusCategory, iss.statusName),
    priority: mapPriority(iss.priorityName),
    due_date: iss.dueDate,
    completed_at: iss.statusCategory === "done" ? iss.updated : null,
    updated_at: nowIso,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("tasks")
      .upsert(rows, { onConflict: "created_by,external_system,external_id" });
    if (error) throw new Error(`Falha ao gravar tarefas do Jira: ${error.message}`);
  }

  return { imported: rows.length, pushed };
}
