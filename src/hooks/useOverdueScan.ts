import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SOURCE_LABEL, type SourceKey } from "@/lib/sources";

// Scans tasks past their due date and creates in-app notifications
// (one per task, deduped via notifications.task_id).
async function scan() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().slice(0, 10);

  const { data: overdue } = await supabase
    .from("tasks")
    .select("id, title, due_date, source, status")
    .neq("status", "done")
    .lt("due_date", todayISO);

  if (!overdue || overdue.length === 0) return;

  const ids = overdue.map((t) => t.id);
  const { data: existing } = await supabase
    .from("notifications")
    .select("task_id")
    .in("task_id", ids);

  const already = new Set((existing ?? []).map((n) => n.task_id));
  const toInsert = overdue
    .filter((t) => !already.has(t.id))
    .map((t) => {
      const label = SOURCE_LABEL[(t.source as SourceKey) ?? "pessoal"] ?? "Tarefa";
      const dueLabel = t.due_date
        ? new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR")
        : "";
      return {
        task_id: t.id,
        title: `Tarefa atrasada · ${label}`,
        body: `"${t.title}" venceu em ${dueLabel}.`,
      };
    });

  if (toInsert.length === 0) return;
  await supabase.from("notifications").insert(toInsert);
}

export function useOverdueScan() {
  const qc = useQueryClient();
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        await scan();
        if (alive) qc.invalidateQueries({ queryKey: ["notifications"] });
      } catch (e) {
        console.error("[overdue-scan]", e);
      }
    };
    run();
    const id = setInterval(run, 5 * 60_000);
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [qc]);
}
