import { useEffect, useMemo, useState } from "react";
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

function inRange(task: Task) {
  const ws = startOfWeek();
  const we = endOfWeek();
  if (task.recurrence !== "none") return true;
  const ref = task.due_date ?? task.start_date;
  if (!ref) {
    const c = new Date(task.created_at);
    return c >= ws && c <= we;
  }
  const d = new Date(`${ref}T12:00:00`);
  return d >= ws && d <= we;
}

type AgendaMeta = { time: string; location: string | null };
type VisibleTask = Task & { agenda?: AgendaMeta; sortAt: number };

const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function dayLabel(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  const base = `${DOW[target.getDay()]} ${String(target.getDate()).padStart(2, "0")}/${String(target.getMonth() + 1).padStart(2, "0")}`;
  if (diff === 0) return `hoje · ${base}`;
  if (diff === 1) return `amanhã · ${base}`;
  return base;
}

function meetingToTask(m: Meeting): VisibleTask {
  const dateStr = m.starts_at.slice(0, 10);
  const time = new Date(m.starts_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
    agenda: { time, location: m.location ?? null },
    sortAt: new Date(m.starts_at).getTime(),
  };
}

function taskSortAt(t: Task): number {
  const ref = t.due_date ?? t.start_date;
  if (ref) return new Date(`${ref}T12:00:00`).getTime();
  return new Date(t.created_at).getTime();
}

const ORDER_KEY = "anora.tasks.order.v1";

function loadOrder(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ORDER_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveOrder(o: Record<string, number>) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(o));
}


function TasksPage() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [filter, setFilter] = useState<SourceKey | "all">("all");
  const [order, setOrder] = useState<Record<string, number>>(() =>
    typeof window !== "undefined" ? loadOrder() : {},
  );
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    saveOrder(order);
  }, [order]);

  const visible = useMemo<VisibleTask[]>(() => {
    // Página de tarefas mostra apenas tarefas criadas aqui.
    // Sincronização é unidirecional: tarefas → calendário (não o contrário).
    const own: VisibleTask[] = tasks
      .filter((t) => inRange(t) || t.status !== "done")
      .map((t) => ({ ...t, sortAt: taskSortAt(t) }));

    return own.filter((t) => filter === "all" || t.source === filter);
  }, [tasks, filter]);

  const byStatus = (status: TaskStatus) =>
    visible
      .filter((t) => t.status === status)
      .sort((a, b) => {
        const oa = order[a.id];
        const ob = order[b.id];
        if (oa != null && ob != null) return oa - ob;
        if (oa != null) return -1;
        if (ob != null) return 1;
        return a.sortAt - b.sortAt;
      });

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const isMeeting = id.startsWith("m:");
      const realId = isMeeting ? id.slice(2) : id;
      const table = isMeeting ? "meetings" : "tasks";
      let jiraKey: string | null = null;
      if (!isMeeting) {
        const { data: current } = await supabase
          .from("tasks")
          .select("external_system, external_id")
          .eq("id", realId)
          .maybeSingle();
        if (current?.external_system === "jira" && current.external_id) {
          jiraKey = current.external_id;
        }
      }
      const { error } = await supabase
        .from(table)
        .update({
          status,
          completed_at: status === "done" ? new Date().toISOString() : null,
        })
        .eq("id", realId);
      if (error) throw new Error(error.message);
      if (jiraKey) {
        try {
          const { transitionJiraIssue } = await import("@/lib/jira.functions");
          await transitionJiraIssue({ data: { issueKey: jiraKey, status } });
        } catch (e) {
          console.warn("Falha ao mover issue no Jira:", e);
        }
      }
      if (!isMeeting) {
        const { data: cur2 } = await supabase
          .from("tasks")
          .select("external_system, external_id")
          .eq("id", realId)
          .maybeSingle();
        if (cur2?.external_system === "notion" && cur2.external_id) {
          try {
            const { transitionNotionPage } = await import("@/lib/notion.functions");
            await transitionNotionPage({ data: { pageId: cur2.external_id, status } });
          } catch (e) {
            console.warn("Falha ao mover página no Notion:", e);
          }
        }
      }
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

  const changeSource = useMutation({
    mutationFn: async ({ id, source }: { id: string; source: SourceKey }) => {
      const isMeeting = id.startsWith("m:");
      const realId = isMeeting ? id.slice(2) : id;
      const table = isMeeting ? "meetings" : "tasks";
      const { data: row, error: readErr } = await supabase
        .from(table)
        .select("title")
        .eq("id", realId)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);
      const { error } = await supabase.from(table).update({ source }).eq("id", realId);
      if (error) throw new Error(error.message);
      if (row?.title) {
        const { learnSourceRule } = await import("@/lib/learn-source");
        await learnSourceRule(row.title, source);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Anora aprendeu: próximos iguais vão para essa empresa.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Reordena: coloca `draggedId` imediatamente antes de `targetId` (ou no final se null),
  // dentro do status alvo. Persiste no localStorage.
  function reorder(draggedId: string, targetStatus: TaskStatus, targetId: string | null) {
    const current = byStatus(targetStatus).filter((t) => t.id !== draggedId);
    const dragged = visible.find((t) => t.id === draggedId);
    if (!dragged) return;
    const idx = targetId ? current.findIndex((t) => t.id === targetId) : current.length;
    const nextIds = [...current.map((t) => t.id)];
    nextIds.splice(idx === -1 ? current.length : idx, 0, draggedId);
    const next = { ...order };
    // remove ordens antigas de outras colunas para esse id
    delete next[draggedId];
    nextIds.forEach((id, i) => {
      next[id] = i;
    });
    setOrder(next);
    if (dragged.status !== targetStatus) {
      move.mutate({ id: draggedId, status: targetStatus });
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Tarefas</h1>
        <span className="text-xs text-muted-foreground">Semana atual</span>
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
        {visibleSources.map((s) => (
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
            {STATUS_ORDER.map((status) => {
              const items = byStatus(status);
              return (
                <div
                  key={status}
                  className="w-72 shrink-0 rounded-xl border bg-secondary/40 p-2"
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    if (!id) return;
                    reorder(id, status, null);
                    setDragOverId(null);
                  }}
                >
                  <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                    {STATUS_LABEL[status]} · {items.length}
                  </p>
                  <div className="space-y-2 min-h-8">
                    {items.map((t) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", t.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverId(t.id);
                        }}
                        onDragLeave={() => setDragOverId((v) => (v === t.id ? null : v))}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const id = e.dataTransfer.getData("text/plain");
                          if (id && id !== t.id) reorder(id, status, t.id);
                          setDragOverId(null);
                        }}
                        className={dragOverId === t.id ? "rounded-lg ring-2 ring-foreground/30" : ""}
                      >
                        <TaskCard
                          task={t}
                          onMove={(s) => move.mutate({ id: t.id, status: s })}
                          onDelete={() => remove.mutate(t.id)}
                          onChangeSource={(s) =>
                            changeSource.mutate({ id: t.id, source: s })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Tarefa</th>
                <th className="p-3">Empresa</th>
                <th className="p-3">Dia</th>
                <th className="p-3">Prioridade</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...visible]
                .sort((a, b) => a.sortAt - b.sortAt)
                .map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="p-3">
                      <span className={isOverdue(t) ? "text-reuniao" : ""}>{t.title}</span>
                    </td>
                    <td className="p-3">
                      <select
                        value={t.source}
                        onChange={(e) =>
                          changeSource.mutate({ id: t.id, source: e.target.value as SourceKey })
                        }
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                      >
                        {SOURCES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {dayLabel(new Date(t.sortAt))}
                      {t.agenda && ` · ${t.agenda.time}`}
                    </td>
                    <td className="p-3 text-xs">{PRIORITY_LABEL[t.priority]}</td>
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
                  <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
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
  onChangeSource,
}: {
  task: VisibleTask;
  onMove: (s: TaskStatus) => void;
  onDelete: () => void;
  onChangeSource: (s: SourceKey) => void;
}) {
  const when = dayLabel(new Date(task.sortAt));
  return (
    <div
      className={`cursor-grab active:cursor-grabbing rounded-lg border border-l-4 p-3 ${SOURCE_BORDER[task.source]} ${SOURCE_TINT[task.source]}`}
    >
      <p className="text-sm">{task.title}</p>
      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        <p>
          {when}
          {task.agenda ? ` · ${task.agenda.time}` : ""}
        </p>
        {task.agenda?.location && (
          <p className="line-clamp-1">📍 {task.agenda.location}</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {!task.agenda && <span>{PRIORITY_LABEL[task.priority]}</span>}
        {task.recurrence !== "none" && <span>recorrente</span>}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <select
          value={task.source}
          onChange={(e) => onChangeSource(e.target.value as SourceKey)}
          className="rounded-md border bg-background px-1.5 py-1 text-[11px]"
          title="Mudar empresa"
        >
          {SOURCES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
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
