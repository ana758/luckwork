import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Sincroniza páginas do Notion (Devore) → tarefas do Anora. */
export const syncNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runNotionSync } = await import("./notion-sync.server");
    return runNotionSync(context.supabase, context.userId);
  });

/** Move a página Notion para o status equivalente. */
export const transitionNotionPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { pageId: string; status: "todo" | "doing" | "onhold" | "done" }) => input,
  )
  .handler(async ({ data }) => {
    const { transitionPage } = await import("./notion.server");
    const ok = await transitionPage(data.pageId, data.status);
    return { ok };
  });

/** Cria uma página nova no DAILY GESTÃO (Devore). */
export const createNotionDailyPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      title: string;
      dueDate?: string | null;
      status?: "todo" | "doing" | "onhold" | "done";
      priority?: "alta" | "media" | "baixa";
    }) => input,
  )
  .handler(async ({ data }) => {
    const { createDailyGestaoPage } = await import("./notion.server");
    return (await createDailyGestaoPage(data)) ?? { pageId: null, url: null };
  });
