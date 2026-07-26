import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Sincroniza as agendas do Google (todas as contas conectadas) → reuniões do Anora. */
export const syncGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runCalendarSync } = await import("./gcal-sync.server");
    return runCalendarSync(context.supabase, context.userId);
  });

/** Envia uma reunião/tarefa do Anora para o Google Agenda da conta escolhida. */
export const pushToGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      title: string;
      startsAt: string;
      endsAt?: string | null;
      notes?: string | null;
      account?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { runCalendarPush } = await import("./gcal-sync.server");
    return runCalendarPush(context.supabase, context.userId, data);
  });

/** Move um evento do Google (arrastar no calendário → nova data/hora). */
export const moveGoogleEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      googleAccount: string;
      googleEventId: string;
      startsAt: string;
      endsAt?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { runMoveGoogleEvent } = await import("./gcal-sync.server");
    return runMoveGoogleEvent(context.supabase, context.userId, data);
  });

/** Lista as contas Google conectadas (para a tela de Ajustes). */
export const listGoogleAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { runListAccounts } = await import("./gcal-sync.server");
    return runListAccounts();
  });

