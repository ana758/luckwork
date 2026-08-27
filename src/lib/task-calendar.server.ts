/**
 * Mantém o Google Agenda em dia com o que a Ana edita numa tarefa da LUCK.
 * Qualquer mudança de título, data, horário ou notas reflete no calendário.
 */
import { runCalendarPush, runDeleteGoogleEvent, runPatchGoogleEvent } from "./gcal-sync.server";

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  source: string | null;
  due_date: string | null;
  due_time: string | null;
  google_event_id: string | null;
  google_account: string | null;
};

function startsAtFor(task: TaskRow) {
  const time = task.due_time ? task.due_time.slice(0, 5) : null;
  return `${task.due_date}T${time ?? "09:00"}:00`;
}

export async function runSyncTaskToCalendar(supabase: any, userId: string, taskId: string) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, notes, source, due_date, due_time, google_event_id, google_account")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const task = data as TaskRow | null;
  if (!task) throw new Error("Tarefa não encontrada.");

  const linked = Boolean(task.google_event_id && task.google_account);

  // Sem data: nada para mostrar no calendário — remove o evento se existir.
  if (!task.due_date) {
    if (linked) {
      try {
        await runDeleteGoogleEvent(supabase, userId, {
          googleAccount: task.google_account!,
          googleEventId: task.google_event_id!,
        });
      } catch {
        /* segue */
      }
      await supabase
        .from("tasks")
        .update({ google_event_id: null, google_account: null })
        .eq("id", task.id);
    }
    return { synced: false as const };
  }

  const allDay = !task.due_time;
  const startsAt = startsAtFor(task);

  if (linked) {
    await runPatchGoogleEvent(supabase, userId, {
      googleAccount: task.google_account!,
      googleEventId: task.google_event_id!,
      title: task.title,
      notes: task.notes,
      startsAt,
      allDay,
    });
    return { synced: true as const };
  }

  const res = await runCalendarPush(supabase, userId, {
    title: task.title,
    startsAt,
    allDay,
    notes: task.notes,
    source: task.source,
  });
  if (res.eventId) {
    await supabase
      .from("tasks")
      .update({
        google_event_id: res.eventId,
        google_account: res.calendarId,
        mirror_event_id: res.mirrorEventId ?? null,
        mirror_account: res.mirrorAccount ?? null,
        external_url: res.url ?? null,
      })
      .eq("id", task.id);
  }

  return { synced: true as const };
}
