import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Reflete no Google Agenda qualquer alteração feita numa tarefa da LUCK. */
export const syncTaskToCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { taskId: string }) => {
    if (!input?.taskId) throw new Error("taskId obrigatório.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { runSyncTaskToCalendar } = await import("./task-calendar.server");
    return runSyncTaskToCalendar(context.supabase, context.userId, data.taskId);
  });
