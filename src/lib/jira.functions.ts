import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Sincroniza issues do Jira (projeto Angi | Commercial & Marketing) → tarefas do Anora. */
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
