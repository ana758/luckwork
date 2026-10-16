import { supabase } from "@/integrations/supabase/client";

/**
 * Exclui uma tarefa e, junto, o evento dela no Google Agenda (e a cópia na
 * agenda pessoal). Usado em qualquer tela, para a tarefa não deixar um
 * compromisso solto no calendário.
 */
export async function deleteTaskEverywhere(taskId: string): Promise<{ googleOk: boolean; wasLinked: boolean }> {
  const { data: row } = await supabase
    .from("tasks")
    .select("google_event_id, google_account")
    .eq("id", taskId)
    .maybeSingle();
  const r = row as { google_event_id?: string | null; google_account?: string | null } | null;

  let googleOk = true;
  let wasLinked = false;
  if (r?.google_event_id && r?.google_account) {
    wasLinked = true;
    try {
      const { deleteGoogleEvent } = await import("@/lib/gcal.functions");
      await deleteGoogleEvent({
        data: { googleAccount: r.google_account, googleEventId: r.google_event_id },
      });
    } catch {
      googleOk = false;
    }
  }
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);
  return { googleOk, wasLinked };
}
