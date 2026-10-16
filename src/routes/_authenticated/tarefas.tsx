import { useEffect, useMemo, useState } from "react";
import { localDateKey, meetingDateKey, meetingTimeLabel } from "@/lib/all-day";
import { AlertCircle } from "lucide-react";
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
  RECURRENCE_LABEL,
  type Meeting,
  type SourceKey,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type Recurrence,
} from "@/lib/sources";
import { useArchivedSources } from "@/lib/archived-sources";
import { TaskEditModal } from "@/components/TaskEditModal";



export const Route = createFileRoute("/_authenticated/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas · LUCK" },
      {
        name: "description",
        content: "Board e lista das suas tarefas por empresa, com visão semanal ou mensal.",
      },
      { property: "og:title", content: "Tarefas · LUCK" },
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
  const dateStr = meetingDateKey(m);
  const time = meetingTimeLabel(m) ?? "";
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
  if (ref) {
    const time = t.due_time ? t.due_time.slice(0, 5) : "12:00";
    return new Date(`${ref}T${time}:00`).getTime();
  }
  return new Date(t.created_at).getTime();
}

type Period = "today" | "tomorrow" | "week" | "overdue" | "all";

const PERIOD_OPTIONS: { v: Period; l: string }[] = [
  { v: "today", l: "Hoje" },
  { v: "tomorrow", l: "Amanhã" },
  { v: "week", l: "Esta semana" },
  { v: "overdue", l: "Atrasadas" },
  { v: "all", l: "Todas" },
];

const fmtShort = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

function periodDescription(period: Period) {
  if (period === "today") return `Hoje · ${fmtShort(new Date())}`;
  if (period === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `Amanhã · ${fmtShort(d)}`;
  }
  if (period === "week") return `Esta semana · ${fmtShort(startOfWeek())} a ${fmtShort(endOfWeek())}`;
  if (period === "overdue") return "Atrasadas, de qualquer data";
  return "Todas as datas";
}

function dateKeyOf(t: Task) {
  return t.due_date ?? t.start_date ?? null;
}

function matchesPeriod(t: Task, period: Period) {
  if (period === "all") return true;
  if (period === "overdue") return isOverdue(t);
  if (period === "week") return inRange(t);
  const key = dateKeyOf(t);
  if (!key) return false;
  const d = new Date();
  if (period === "tomorrow") d.setDate(d.getDate() + 1);
  return key === localDateKey(d);
}

/** "14:30" quando a tarefa tem horário; vazio quando não tem (sem hora inventada). */
function timeOf(t: VisibleTask) {
  if (t.agenda?.time) return t.agenda.time;
  if (t.due_time) return t.due_time.slice(0, 5);
  return "";
}

const ORDER_KEY = "luck.tasks.order.v1";

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
  const { visibleSources } = useArchivedSources();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [filter, setFilter] = useState<SourceKey | "all">("all");
  const [period, setPeriod] = useState<Period>("week");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [showDone, setShowDone] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [order, setOrder] = useState<Record<string, number>>(() =>
    typeof window !== "undefined" ? loadOrder() : {},
  );
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    saveOrder(order);
  }, [order]);

  const visible = useMemo<VisibleTask[]>(() => {
    // Página de tarefas mostra apenas tarefas criadas aqui.
    // Sincronização é unidirecional: tarefas → calendário (não o contrário).
    const own: VisibleTask[] = tasks.map((t) => ({ ...t, sortAt: taskSortAt(t) }));

    // Compromisso marcado como concluído no Calendário aparece em "Concluída".
    // Só os concluídos entram aqui: compromissos em aberto continuam só na agenda.
    // Se já existe uma tarefa com o mesmo título no mesmo dia, o compromisso é a
    // cópia dela: não entra de novo (evita "A fazer" e "Concluída" ao mesmo tempo).
    const normTitle = (v: string) =>
      v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    const taskKeys = new Set(
      tasks.map((t) => `${normTitle(t.title)}::${t.due_date ?? t.start_date ?? ""}`),
    );
    const doneMeetings: VisibleTask[] = meetings
      .filter((m) => Boolean(m.completed_at) || m.status === "done")
      .map(meetingToTask)
      .filter((t) => !taskKeys.has(`${normTitle(t.title)}::${t.due_date ?? ""}`));

    const term = search
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    const norm = (v: string) =>
      v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    return [...own, ...doneMeetings]
      .filter((t) => matchesPeriod(t, period))
      .filter((t) => filter === "all" || t.source === filter)
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
      .filter((t) => !term || norm(t.title).includes(term) || norm(t.notes ?? "").includes(term));
  }, [tasks, meetings, filter, period, search, statusFilter, priorityFilter]);

  // Quantas atrasadas existem fora da tela atual, para avisar sem misturar.
  const overdueCount = useMemo(
    () => tasks.filter((t) => isOverdue(t) && (filter === "all" || t.source === filter)).length,
    [tasks, filter],
  );
  const hasFilters =
    search.trim() !== "" || statusFilter !== "all" || priorityFilter !== "all" || filter !== "all";
  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setFilter("all");
  }
  const doneCount = visible.filter((t) => t.status === "done").length;
  const doneOpen = showDone || statusFilter === "done";

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
    mutationFn: async ({
      id,
      status,
      externalSystem,
      externalId,
    }: {
      id: string;
      status: TaskStatus;
      externalSystem?: string | null;
      externalId?: string | null;
    }) => {
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

      if (!isMeeting && externalSystem === "jira" && externalId) {
        void import("@/lib/jira.functions")
          .then(({ transitionJiraIssue }) =>
            transitionJiraIssue({ data: { issueKey: externalId, status } }),
          )
          .catch((e) => {
            console.warn("Falha ao mover issue no Jira:", e);
            toast.error(`Jira: ${(e as Error).message}`);
          });
      }

      if (!isMeeting && externalSystem === "notion" && externalId) {
        void import("@/lib/notion.functions")
          .then(({ transitionNotionPage }) =>
            transitionNotionPage({ data: { pageId: externalId, status } }),
          )
          .catch((e) => {
            console.warn("Falha ao mover página no Notion:", e);
            toast.error(`Notion: ${(e as Error).message}`);
          });
      }
    },
    onMutate: async (v) => {
      const isMeeting = v.id.startsWith("m:");
      const key = isMeeting ? ["meetings"] : ["tasks"];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[] | Meeting[]>(key);
      const realId = isMeeting ? v.id.slice(2) : v.id;
      const completedAt = v.status === "done" ? new Date().toISOString() : null;

      queryClient.setQueryData<Task[] | Meeting[]>(key, (old) => {
        if (!old) return old;
        return old.map((item) =>
          item.id === realId ? { ...item, status: v.status, completed_at: completedAt } : item,
        ) as Task[] | Meeting[];
      });

      return { previous, key };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (e: Error, _v, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const isMeeting = id.startsWith("m:");
      const realId = isMeeting ? id.slice(2) : id;
      if (isMeeting) {
        const target = meetings.find((m) => m.id === realId);
        if (!target) throw new Error("Reunião não encontrada.");
        const { error } = await supabase
          .from("meetings")
          .update({ hidden: true })
          .eq("title", target.title)
          .eq("starts_at", target.starts_at);
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
      const { error } = isMeeting
        ? await supabase.from("meetings").update({ source }).eq("id", realId)
        : await supabase.from("tasks").update({ source, locally_managed: true }).eq("id", realId);
      if (error) throw new Error(error.message);
      if (row?.title) {
        const { learnSourceRule } = await import("@/lib/learn-source");
        await learnSourceRule(row.title, source);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("LUCK aprendeu: próximos iguais vão para essa empresa.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editTask = useMutation({
    mutationFn: async (payload: {
      id: string;
      title: string;
      notes: string | null;
      due_date: string | null;
      priority: TaskPriority;
      recurrence: Recurrence;
    }) => {
      const isMeeting = payload.id.startsWith("m:");
      const realId = isMeeting ? payload.id.slice(2) : payload.id;
      if (isMeeting) {
        const { error } = await supabase
          .from("meetings")
          .update({ title: payload.title, notes: payload.notes })
          .eq("id", realId);
        if (error) throw new Error(error.message);
        return;
      }
      const { data: prev } = await supabase
        .from("tasks")
        .select("external_system, external_id, title, due_date")
        .eq("id", realId)
        .maybeSingle();
      const { error } = await supabase
        .from("tasks")
        .update({
          title: payload.title,
          notes: payload.notes,
          due_date: payload.due_date,
          start_date: payload.due_date,
          priority: payload.priority,
          recurrence: payload.recurrence,
          locally_managed: true,
        })
        .eq("id", realId);
      if (error) throw new Error(error.message);

      // Push bilateral → Jira quando título/data mudam em issues sincronizadas
      if (prev?.external_system === "jira" && prev.external_id) {
        const summaryChanged = payload.title !== prev.title;
        const dueChanged = (payload.due_date ?? null) !== (prev.due_date ?? null);
        if (summaryChanged || dueChanged) {
          void import("@/lib/jira.functions")
            .then(({ updateJiraIssue }) =>
              updateJiraIssue({
                data: {
                  issueKey: prev.external_id!,
                  ...(summaryChanged ? { summary: payload.title } : {}),
                  ...(dueChanged ? { dueDate: payload.due_date } : {}),
                },
              }),
            )
            .catch((e) => {
              console.warn("Falha ao atualizar issue no Jira:", e);
              toast.error(`Jira: ${(e as Error).message}`);
            });
        }
      }

      // Qualquer alteração (nome, data) reflete no calendário da LUCK e no Google.
      if (!isMeeting) {
        try {
          const { syncTaskToCalendar } = await import("@/lib/task-calendar.functions");
          await syncTaskToCalendar({ data: { taskId: realId } });
        } catch (e) {
          console.warn("Calendário:", e);
        }
      }
    },
    onSuccess: () => {
      toast.success("Tarefa atualizada");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setEditingId(null);
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
      move.mutate({
        id: draggedId,
        status: targetStatus,
        externalSystem: dragged.external_system,
        externalId: dragged.external_id,
      });
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Tarefas</h1>
        <span className="text-xs text-muted-foreground">{periodDescription(period)}</span>
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

      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          options={PERIOD_OPTIONS.map((o) => ({ v: o.v, l: o.l }))}
          value={period}
          onChange={(v) => setPeriod(v as Period)}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título ou nota"
          className="min-w-[160px] flex-1 rounded-md border bg-background px-3 py-1.5 text-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "all")}
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
          aria-label="Filtrar por status"
        >
          <option value="all">Todos os status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "all")}
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
          aria-label="Filtrar por prioridade"
        >
          <option value="all">Toda prioridade</option>
          {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Limpar filtros
          </button>
        )}
        {period === "overdue" && visible.some((t) => !t.id.startsWith("m:")) && (
          <button
            onClick={() => setReviewing(true)}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
          >
            Revisar atrasadas em lote
          </button>
        )}
      </div>

      {period !== "overdue" && overdueCount > 0 && (
        <button
          onClick={() => setPeriod("overdue")}
          className="flex items-center gap-1.5 rounded-md border border-reuniao/40 bg-reuniao/5 px-3 py-1.5 text-xs text-reuniao"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          {overdueCount} {overdueCount === 1 ? "tarefa atrasada" : "tarefas atrasadas"} · ver atrasadas
        </button>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
          <div className="flex gap-3 min-w-max">
            {STATUS_ORDER.filter((s) => statusFilter === "all" || s === statusFilter).map((status) => {
              const items = byStatus(status);
              const collapsed = status === "done" && !doneOpen;
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
                    {status === "done" && items.length > 0 && (
                      <button
                        onClick={() => setShowDone((v) => !v)}
                        className="ml-2 underline hover:text-foreground"
                      >
                        {collapsed ? "mostrar" : "recolher"}
                      </button>
                    )}
                  </p>
                  <div className="space-y-2 min-h-8">
                    {collapsed && items.length > 0 && (
                      <p className="px-1 text-[11px] text-muted-foreground">
                        {items.length} concluída{items.length === 1 ? "" : "s"} recolhida{items.length === 1 ? "" : "s"}.
                        Arraste uma tarefa para cá para concluir.
                      </p>
                    )}
                    {(collapsed ? [] : items).map((t) => (
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
                          onMove={(s) =>
                            move.mutate({
                              id: t.id,
                              status: s,
                              externalSystem: t.external_system,
                              externalId: t.external_id,
                            })
                          }
                          onDelete={() => remove.mutate(t.id)}
                          onChangeSource={(s) =>
                            changeSource.mutate({ id: t.id, source: s })
                          }
                          onEdit={() => setEditingId(t.id)}
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
                .filter((t) => t.status !== "done" || doneOpen)
                .sort((a, b) => a.sortAt - b.sortAt)
                .map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="p-3">
                      <button
                        onClick={() => setEditingId(t.id)}
                        className={`text-left hover:underline ${isOverdue(t) ? "text-reuniao" : ""}`}
                      >
                        {t.title}
                      </button>
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
                      {timeOf(t) && ` · ${timeOf(t)}`}
                      {isOverdue(t) && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-reuniao">
                          <AlertCircle className="h-3 w-3" /> atrasada
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs">{PRIORITY_LABEL[t.priority]}</td>
                    <td className="p-3">
                      <select
                        value={t.status}
                        onChange={(e) =>
                          move.mutate({
                            id: t.id,
                            status: e.target.value as TaskStatus,
                            externalSystem: t.external_system,
                            externalId: t.external_id,
                          })
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
                    Nenhuma tarefa neste filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {doneCount > 0 && statusFilter !== "done" && (
            <div className="border-t p-2 text-center">
              <button
                onClick={() => setShowDone((v) => !v)}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                {showDone ? "Recolher concluídas" : `Mostrar ${doneCount} concluída${doneCount === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
        </div>
      )}

      {reviewing && (
        <OverdueReviewModal
          items={visible.filter((t) => !t.id.startsWith("m:") && isOverdue(t))}
          onClose={() => setReviewing(false)}
        />
      )}

      {editingId &&
        (() => {
          const item = visible.find((t) => t.id === editingId);
          if (!item) return null;
          // Tarefa de verdade: usa o editor completo (nome, dia, horário,
          // empresa, repetição e notas) que já reflete tudo no calendário.
          if (!editingId.startsWith("m:")) {
            const real = tasks.find((t) => t.id === editingId);
            if (real)
              return <TaskEditModal task={real} onClose={() => setEditingId(null)} />;
          }
          return (
            <EditTaskModal
              task={item}
              onClose={() => setEditingId(null)}
              saving={editTask.isPending}
              onSave={(p) => editTask.mutate({ id: editingId, ...p })}
            />
          );
        })()}

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
  onEdit,
}: {
  task: VisibleTask;
  onMove: (s: TaskStatus) => void;
  onDelete: () => void;
  onChangeSource: (s: SourceKey) => void;
  onEdit: () => void;
}) {
  const when = dayLabel(new Date(task.sortAt));
  return (
    <div
      className={`cursor-grab active:cursor-grabbing rounded-lg border border-l-4 p-3 ${SOURCE_BORDER[task.source]} ${SOURCE_TINT[task.source]}`}
    >
      <button onClick={onEdit} className="block w-full text-left">
        <p className="text-sm hover:underline">{task.title}</p>
        <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          <p>
            {when}
            {timeOf(task) ? ` · ${timeOf(task)}` : ""}
            {isOverdue(task) && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-reuniao">
                <AlertCircle className="h-3 w-3" /> atrasada
              </span>
            )}
          </p>
          {task.agenda?.location && (
            <p className="line-clamp-1">📍 {task.agenda.location}</p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {!task.agenda && <span>{PRIORITY_LABEL[task.priority]}</span>}
          {task.recurrence !== "none" && <span>recorrente</span>}
        </div>
      </button>
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

/**
 * Revisão em lote das atrasadas. Nada é alterado sozinho: a Ana escolhe os
 * itens, escolhe a ação e vê a prévia exata antes de confirmar.
 */
function OverdueReviewModal({ items, onClose }: { items: VisibleTask[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"done" | "reschedule">("done");
  const [newDate, setNewDate] = useState(localDateKey(new Date()));

  const chosen = items.filter((t) => selected.has(t.id));

  const apply = useMutation({
    mutationFn: async () => {
      let ok = 0;
      for (const t of chosen) {
        const patch =
          action === "done"
            ? { status: "done" as TaskStatus, completed_at: new Date().toISOString() }
            : { due_date: newDate, start_date: newDate, locally_managed: true };
        const { error } = await supabase.from("tasks").update(patch).eq("id", t.id);
        if (error) throw new Error(error.message);
        ok++;
        if (action === "reschedule") {
          try {
            const { syncTaskToCalendar } = await import("@/lib/task-calendar.functions");
            await syncTaskToCalendar({ data: { taskId: t.id } });
          } catch (e) {
            console.warn("Calendário:", e);
          }
        }
      }
      return ok;
    },
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? "tarefa alterada" : "tarefas alteradas"}`);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-xl bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">Revisar atrasadas em lote</h3>
        <p className="text-[11px] text-muted-foreground">
          Nada muda sozinho. Marque as tarefas, escolha a ação e confira a prévia antes de confirmar.
        </p>

        <div className="flex items-center gap-3 text-xs">
          <button onClick={() => setSelected(new Set(items.map((t) => t.id)))} className="underline">
            Marcar todas ({items.length})
          </button>
          <button onClick={() => setSelected(new Set())} className="underline">
            Desmarcar
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md border p-2">
          {items.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded p-1 text-xs hover:bg-accent">
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={() => toggle(t.id)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words">{t.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {dayLabel(new Date(t.sortAt))} · {SOURCES.find((s) => s.key === t.source)?.label ?? t.source}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="space-y-2 text-xs">
          <label className="flex items-center gap-2">
            <input type="radio" checked={action === "done"} onChange={() => setAction("done")} />
            Marcar como concluídas
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" checked={action === "reschedule"} onChange={() => setAction("reschedule")} />
            Remarcar para
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              onFocus={() => setAction("reschedule")}
              className="rounded-md border bg-background px-2 py-1"
            />
          </label>
        </div>

        <p className="rounded-md bg-secondary p-2 text-[11px]">
          {chosen.length === 0
            ? "Nenhuma tarefa marcada ainda."
            : action === "done"
              ? `Prévia: ${chosen.length} ${chosen.length === 1 ? "tarefa será concluída" : "tarefas serão concluídas"}.`
              : `Prévia: ${chosen.length} ${chosen.length === 1 ? "tarefa vai" : "tarefas vão"} para ${newDate.split("-").reverse().join("/")}. O horário de cada uma é mantido.`}
        </p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs">
            Cancelar
          </button>
          <button
            disabled={chosen.length === 0 || apply.isPending || (action === "reschedule" && !newDate)}
            onClick={() => apply.mutate()}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-50"
          >
            {apply.isPending ? "Aplicando…" : `Aplicar a ${chosen.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTaskModal({
  task,
  onClose,
  onSave,
  saving,
}: {
  task: VisibleTask;
  onClose: () => void;
  onSave: (p: {
    title: string;
    notes: string | null;
    due_date: string | null;
    priority: TaskPriority;
    recurrence: Recurrence;
  }) => void;
  saving: boolean;
}) {
  const isMeeting = task.id.startsWith("m:");
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? task.start_date ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [recurrence, setRecurrence] = useState<Recurrence>(task.recurrence);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">Editar tarefa</h3>
        {isMeeting && (
          <p className="rounded-md bg-secondary p-2 text-[11px] text-muted-foreground">
            Este item veio da agenda. Data, prioridade e recorrência só podem ser alterados no Calendário.
          </p>
        )}
        <label className="block text-xs">
          <span className="text-muted-foreground">Título</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Notas</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        {!isMeeting && (
          <>
            <label className="block text-xs">
              <span className="text-muted-foreground">Data</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs">
                <span className="text-muted-foreground">Prioridade</span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-muted-foreground">Recorrência</span>
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as Recurrence)}
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-xs"
          >
            Cancelar
          </button>
          <button
            disabled={saving || !title.trim()}
            onClick={() =>
              onSave({
                title: title.trim(),
                notes: notes.trim() ? notes.trim() : null,
                due_date: dueDate || null,
                priority,
                recurrence,
              })
            }
            className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
