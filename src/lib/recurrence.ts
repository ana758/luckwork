import { supabase } from "@/integrations/supabase/client";
import type { Recurrence, Task } from "./sources";

/** Próxima data de uma tarefa recorrente (YYYY-MM-DD). */
export function nextDate(dateStr: string, rec: Recurrence): string | null {
  if (rec === "none") return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (rec === "daily") dt.setDate(dt.getDate() + 1);
  else if (rec === "weekly") dt.setDate(dt.getDate() + 7);
  else dt.setMonth(dt.getMonth() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/**
 * Ao concluir uma tarefa recorrente, já cria automaticamente a próxima
 * ocorrência (mesma empresa, horário e notas).
 */
export async function spawnNextOccurrence(task: Task) {
  if (!task.recurrence || task.recurrence === "none" || !task.due_date) return;
  const due = nextDate(task.due_date, task.recurrence);
  if (!due) return;

  const { data: exists } = await supabase
    .from("tasks")
    .select("id")
    .eq("title", task.title)
    .eq("source", task.source)
    .eq("due_date", due)
    .limit(1);
  if ((exists ?? []).length > 0) return;

  const { data: created } = await supabase
    .from("tasks")
    .insert({
      title: task.title,
      notes: task.notes,
      source: task.source,
      priority: task.priority,
      status: "todo",
      due_date: due,
      due_time: task.due_time ?? null,
      recurrence: task.recurrence,
    })
    .select("id")
    .single();

  if (created?.id) {
    const { syncTaskToCalendar } = await import("./task-calendar.functions");
    void syncTaskToCalendar({ data: { taskId: created.id } }).catch(() => {});
  }
}
