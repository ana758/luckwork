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

function meetingToTask(m: Meeting): Task {
  const dateStr = m.starts_at.slice(0, 10);
  return {
    id: `m:${m.id}`,
    title: m.title,
    notes: m.notes,
    source: m.source,
    status: (m.status ?? "todo") as TaskStatus,
    priority: "media",
    start_date: dateStr,
    due_date: dateStr,
    recurrence: "none",
    external_system: "google_calendar",
    external_url: m.external_url,
    completed_at: m.completed_at ?? null,
    created_at: m.starts_at,
    updated_at: m.starts_at,
  };
}

function TasksPage() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [range, setRange] = useState<"week" | "month">("week");
  const [filter, setFilter] = useState<SourceKey | "all">("all");

  const visible = useMemo(() => {
    const now = new Date();
    const start = range === "week" ? startOfWeek() : new Date(now.getFullYear(), now.getMonth(), 1);
    const end =
      range === "week"
        ? endOfWeek()
        : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Eventos da agenda (não-reunião) viram tarefas no período.
    const agendaAsTasks = meetings
      .filter((m) => m.meeting_type !== "Reunião")
      .filter((m) => {
        const d = new Date(m.starts_at);
        return d >= start && d <= end;
      })
      .map(meetingToTask);

    const own = tasks.filter((t) => inRange(t, range));

    return [...own, ...agendaAsTasks].filter(
      (t) => filter === "all" || t.source === filter,
    );
  }, [tasks, meetings, range, filter]);

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const isMeeting = id.startsWith("m:");
      const realId = isMeeting ? id.slice(2) : id;
      const table = isMeeting ? "meetings" : "tasks";
      const { error } = await supabase
        .from(table)
        .update({
          status,
          completed_at: status === "done" ? new Date().toISOString() : null,
        })
        .eq("id", realId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({
        queryKey: [v.id.startsWith("m:") ? "meetings" : "tasks"],
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const isMeeting = id.startsWith("m:");
      const realId = isMeeting ? id.slice(2) : id;
      if (isMeeting) {
        const { error } = await supabase
          .from("meetings")
          .update({ hidden: true })
          .eq("id", realId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("tasks").delete().eq("id", realId);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_d, id) => {
      toast.success("Removido");
      queryClient.invalidateQueries({
        queryKey: [id.startsWith("m:") ? "meetings" : "tasks"],
      });
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

function MeetingChip({ meeting }: { meeting: Meeting }) {
  const d = new Date(meeting.starts_at);
  const when =
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const isReuniao = meeting.meeting_type === "Reunião";
  return (
    <div
      className={`min-w-[220px] shrink-0 rounded-lg border border-l-4 ${SOURCE_BORDER[meeting.source]} ${SOURCE_TINT[meeting.source]} p-2.5`}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span
          className={`h-1.5 w-1.5 rounded-full ${isReuniao ? "bg-reuniao" : SOURCE_DOT[meeting.source]}`}
        />
        {isReuniao ? "Reunião" : "Agenda"} · {when}
      </div>
      <p className="mt-1 text-sm leading-snug line-clamp-2">{meeting.title}</p>
      {meeting.people && (
        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{meeting.people}</p>
      )}
    </div>
  );
}


