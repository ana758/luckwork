import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { endOfWeek, startOfWeek, useMeetings, useTasks } from "@/lib/queries";
import {
  isOverdue,
  PRIORITY_LABEL,
  SOURCES,
  SOURCE_BORDER,
  SOURCE_TINT,
  SOURCE_DOT,
  STATUS_LABEL,
  STATUS_ORDER,
  type Meeting,
  type SourceKey,
  type Task,
  type TaskStatus,
} from "@/lib/sources";


export const Route = createFileRoute("/_authenticated/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas · Anora" },
      {
        name: "description",
        content: "Board e lista das suas tarefas por empresa, com visão semanal ou mensal.",
      },
      { property: "og:title", content: "Tarefas · Anora" },
      { property: "og:description", content: "Board e lista das suas tarefas por empresa." },
    ],
  }),
  component: TasksPage,
});

function inRange(task: Task, range: "week" | "month") {
  if (task.recurrence !== "none") return true;
  const ref = task.due_date ?? task.start_date;
  if (!ref) return true;
  const d = new Date(`${ref}T12:00:00`);
  if (range === "week") return d >= startOfWeek() && d <= endOfWeek();
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function TasksPage() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [range, setRange] = useState<"week" | "month">("week");
  const [filter, setFilter] = useState<SourceKey | "all">("all");

  const visible = useMemo(
    () =>
      tasks.filter((t) => inRange(t, range) && (filter === "all" || t.source === filter)),
    [tasks, range, filter],
  );

  const visibleMeetings = useMemo(() => {
    const now = new Date();
    const start = range === "week" ? startOfWeek() : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = range === "week" ? endOfWeek() : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return meetings
      .filter((m) => {
        const d = new Date(m.starts_at);
        return d >= start && d <= end && (filter === "all" || m.source === filter);
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [meetings, range, filter]);




  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const { error } = await supabase
        .from("tasks")
        .update({
          status,
          completed_at: status === "done" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Tarefa removida");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Tarefas</h1>
        
        <Toggle
          options={[
            { v: "week", l: "Semana" },
            { v: "month", l: "Mês" },
          ]}
          value={range}
          onChange={(v) => setRange(v as "week" | "month")}
        />
        <Toggle
          options={[
            { v: "board", l: "Board" },
            { v: "list", l: "Lista" },
          ]}
          value={view}
          onChange={(v) => setView(v as "board" | "list")}
        />
      </header>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs ${filter === "all" ? "border-foreground" : "text-muted-foreground"}`}
        >
          Todas
        </button>
        {SOURCES.map((s) => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
              filter === s.key ? "border-foreground" : "text-muted-foreground"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[s.key]}`} />
            {s.label}
          </button>
        ))}
      </div>



      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
          <div className="flex gap-3 min-w-max">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="w-72 shrink-0 rounded-xl border bg-secondary/40 p-2">
                <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                  {STATUS_LABEL[status]} · {visible.filter((t) => t.status === status).length}
                </p>
                <div className="space-y-2">
                  {visible
                    .filter((t) => t.status === status)
                    .map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onMove={(s) => move.mutate({ id: t.id, status: s })}
                        onDelete={() => remove.mutate(t.id)}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Tarefa</th>
                <th className="p-3">Empresa</th>
                <th className="p-3">Início</th>
                <th className="p-3">Prazo</th>
                <th className="p-3">Prioridade</th>
                <th className="p-3">Atualizado</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3">
                    <span className={isOverdue(t) ? "text-reuniao" : ""}>{t.title}</span>
                  </td>
                  <td className="p-3">
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[t.source]}`} />
                      {t.source}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{t.start_date ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{t.due_date ?? "—"}</td>
                  <td className="p-3 text-xs">{PRIORITY_LABEL[t.priority]}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(t.updated_at).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="p-3">
                    <select
                      value={t.status}
                      onChange={(e) =>
                        move.mutate({ id: t.id, status: e.target.value as TaskStatus })
                      }
                      className="rounded-md border bg-background px-2 py-1 text-xs"
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                    Nenhuma tarefa neste período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Toggle({
  options,
  value,
  onChange,
}: {
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-lg bg-secondary p-1 text-xs">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-md px-3 py-1.5 ${value === o.v ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function TaskCard({
  task,
  onMove,
  onDelete,
}: {
  task: Task;
  onMove: (s: TaskStatus) => void;
  onDelete: () => void;
}) {
  return (
    <div className={`rounded-lg border border-l-4 p-3 ${SOURCE_BORDER[task.source]} ${SOURCE_TINT[task.source]}`}>
      <p className="text-sm">{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {task.due_date && (
          <span className={isOverdue(task) ? "font-medium text-reuniao" : ""}>
            {new Date(`${task.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
          </span>
        )}
        <span>{PRIORITY_LABEL[task.priority]}</span>
        {task.recurrence !== "none" && <span>recorrente</span>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <select
          value={task.status}
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          className="flex-1 rounded-md border bg-background px-2 py-1 text-[11px]"
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          onClick={onDelete}
          className="text-[11px] text-muted-foreground hover:text-reuniao"
        >
          excluir
        </button>
      </div>
    </div>
  );
}


