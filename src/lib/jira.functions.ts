import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Sincroniza issues do Jira (projeto Angi | Commercial & Marketing) → tarefas do LUCK. */
export const syncJira = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runJiraSync } = await import("./jira-sync.server");
    return runJiraSync(context.supabase, context.userId);
  });

/** Marca a issue correspondente como concluída no Jira. */
export const completeJiraIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { issueKey: string }) => input)
  .handler(async ({ data }) => {
    const { transitionToDone } = await import("./jira.server");
    const ok = await transitionToDone(data.issueKey);
    return { ok };
  });

/** Move a issue para a coluna correspondente ao status do LUCK. */
export const transitionJiraIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { issueKey: string; status: "todo" | "doing" | "onhold" | "done" }) => input,
  )
  .handler(async ({ data }) => {
    const { transitionToStatus } = await import("./jira.server");
    const ok = await transitionToStatus(data.issueKey, data.status);
    return { ok };
  });

/** Cria uma nova issue no board Angi | Commercial & Marketing atribuída à Ana. */
export const createJiraIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      summary: string;
      dueDate?: string | null;
      priority?: "alta" | "media" | "baixa" | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { createIssue } = await import("./jira.server");
    return createIssue(data);
  });

/** Atualiza título e/ou data de vencimento de uma issue existente. */
export const updateJiraIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { issueKey: string; summary?: string; dueDate?: string | null }) => input,
  )
  .handler(async ({ data }) => {
    const { updateIssue } = await import("./jira.server");
    const { issueKey, ...patch } = data;
    await updateIssue(issueKey, patch);
    return { ok: true };
  });
