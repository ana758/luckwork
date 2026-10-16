import { supabase } from "@/integrations/supabase/client";

/**
 * Exclui uma tarefa e, junto, o evento dela no Google Agenda (e a cópia na
 * agenda pessoal). Usado em qualquer tela.
 *
 * ORDEM IMPORTANTE: primeiro apaga a linha no banco (é isso que garante que a
 * tarefa não volta ao recarregar) e só depois pede ao Google para apagar o
 * evento. Se o Google demorar ou falhar, a tarefa já está excluída.
 */
export async function deleteTaskEverywhere(taskId: string): Promise<{ googleOk: boolean; wasLinked: boolean }> {
  const { data: row } = await supabase
    .from("tasks")
    .select("google_event_id, google_account")
    .eq("id", taskId)
    .maybeSingle();
  const r = row as { google_event_id?: string | null; google_account?: string | null } | null;

  // 1) Apaga no banco e confirma que realmente apagou.
  const { data: removed, error } = await supabase.from("tasks").delete().eq("id", taskId).select("id");
  if (error) throw new Error(error.message);
  if (!removed || removed.length === 0) {
    const { data: still } = await supabase.from("tasks").select("id").eq("id", taskId).maybeSingle();
    if (still) throw new Error("Não consegui excluir esta tarefa (sem permissão). Tente recarregar a página.");
  }

  // 2) Apaga o evento no Google (com limite de tempo, sem travar a tela).
  let googleOk = true;
  let wasLinked = false;
  if (r?.google_event_id && r?.google_account) {
    wasLinked = true;
    try {
      const { deleteGoogleEvent } = await import("@/lib/gcal.functions");
      await Promise.race([
        deleteGoogleEvent({ data: { googleAccount: r.google_account, googleEventId: r.google_event_id } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), 20000)),
      ]);
    } catch {
      googleOk = false;
    }
  }
  return { googleOk, wasLinked };
}
