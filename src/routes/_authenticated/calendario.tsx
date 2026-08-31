import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Check, Plus, Repeat, MapPin } from "lucide-react";
import { toast } from "sonner";
import { SyncGoogleButton } from "@/components/SyncGoogleButton";
import { MeetingEditModal } from "@/components/MeetingEditModal";
import { TaskEditModal } from "@/components/TaskEditModal";
import { NewMeetingModal } from "@/components/NewMeetingModal";
import { useMeetings, useTasks } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { moveGoogleEvent } from "@/lib/gcal.functions";
import { spawnNextOccurrence } from "@/lib/recurrence";
import { SOURCE_TINT, SOURCE_DOT, type Meeting, type SourceKey, type Task } from "@/lib/sources";
import { useArchivedSources } from "@/lib/archived-sources";

export const Route = createFileRoute("/_authenticated/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário · LUCK" },
      {
        name: "description",
        content: "Visão diária, 5 dias ou mensal com tarefas e reuniões de todas as empresas.",
      },
      { property: "og:title", content: "Calendário · LUCK" },
      { property: "og:description", content: "Visão diária, 5 dias ou mensal de tarefas e reuniões." },
    ],
  }),
  component: CalendarPage,
});

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
type ViewMode = "day" | "2day" | "5day" | "month";

/** Altura de uma hora na grade (px) — blocos maiores, como no Google. */
const HOUR_H = 56;
const DEFAULT_TASK_MIN = 45;
const DEFAULT_MEETING_MIN = 60;

function fmtKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type CalItem = {
  kind: "meeting" | "task";
  id: string;
  title: string;
  dot: string;
  tint: string;
  /** minutos desde 00:00; null = sem horário (dia inteiro) */
  startMin: number | null;
  durationMin: number;
  time: string | null;
  notes: string | null;
  place: string | null;
  recurring: boolean;
  done: boolean;
  meeting?: Meeting;
  task?: Task;
};

function hhmm(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CalendarPage() {
  // Abre sempre na visão de 5 dias — é a que a Ana usa no dia a dia.
  const [view, setView] = useState<ViewMode>("5day");
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const [filter, setFilter] = useState<SourceKey | "all">("all");
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newMeetingDay, setNewMeetingDay] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());

  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrolled = useRef(false);
  /** offset em minutos entre o ponto agarrado e o início do bloco */
  const grabOffset = useRef(0);

  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const { visibleSources } = useArchivedSources();
  const qc = useQueryClient();
  const moveGoogle = useServerFn(moveGoogleEvent);

  const todayKey = fmtKey(new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Abre a grade já na altura das 7h.
  useEffect(() => {
    if (view === "month" || scrolled.current || !gridRef.current) return;
    gridRef.current.scrollTop = 7 * HOUR_H;
    scrolled.current = true;
  }, [view]);

  const visibleMeetings = filter === "all" ? meetings : meetings.filter((m) => m.source === filter);
  const visibleTasks = filter === "all" ? tasks : tasks.filter((t) => t.source === filter);

  function itemsFor(key: string): CalItem[] {
    const items: CalItem[] = [
      ...visibleMeetings
        .filter((m) => fmtKey(new Date(m.starts_at)) === key)
        .map<CalItem>((m) => {
          const isMeeting = m.meeting_type === "Reunião";
          const start = new Date(m.starts_at);
          const startMin = start.getHours() * 60 + start.getMinutes();
          const durationMin = m.ends_at
            ? Math.max(20, Math.round((new Date(m.ends_at).getTime() - start.getTime()) / 60000))
            : DEFAULT_MEETING_MIN;
          return {
            kind: "meeting",
            id: m.id,
            title: m.title,
            dot: isMeeting ? "bg-reuniao" : SOURCE_DOT[m.source],
            tint: isMeeting ? "bg-reuniao-soft border-reuniao/40" : SOURCE_TINT[m.source],
            startMin,
            durationMin,
            time: hhmm(m.starts_at),
            notes: m.notes ?? null,
            place: m.location ?? null,
            recurring: false,
            done: Boolean(m.completed_at),
            meeting: m,
          };
        }),
      ...visibleTasks.filter((t) => t.due_date === key).map<CalItem>(taskItem),
    ];
    // Sempre em ordem de horário — quem não tem horário fica no topo (dia inteiro).
    return items.sort((a, b) => (a.startMin ?? -1) - (b.startMin ?? -1));
  }

  /** Tarefa → bloco do calendário. */
  function taskItem(t: Task): CalItem {
    const hm = t.due_time ? t.due_time.slice(0, 5) : null;
    const startMin = hm ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : null;
    return {
      kind: "task",
      id: t.id,
      title: t.title,
      dot: SOURCE_DOT[t.source],
      tint: SOURCE_TINT[t.source],
      startMin,
      durationMin: DEFAULT_TASK_MIN,
      time: hm,
      notes: t.notes ?? null,
      place: null,
      recurring: Boolean(t.recurrence && t.recurrence !== "none"),
      done: t.status === "done",
      task: t,
    };
  }

  /** Tarefas ainda sem data — ficam numa faixa própria para não sumirem. */
  const undatedTasks = visibleTasks.filter((t) => !t.due_date && t.status !== "done");


  function shift(dir: -1 | 1) {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "5day") d.setDate(d.getDate() + dir * 5);
    else if (view === "2day") d.setDate(d.getDate() + dir * 2);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  }

  const monthDays = useMemo(() => {
    if (view !== "month") return [];
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor, view]);

  const rangeDays = useMemo(() => {
    if (view === "month") return [];
    const n = view === "day" ? 1 : view === "2day" ? 2 : 5;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + i);
      return d;
    });
  }, [cursor, view]);

  const headerLabel =
    view === "month"
      ? cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : view === "day"
        ? cursor.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
        : `${cursor.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} – ${new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + (view === "2day" ? 1 : 4),
          ).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}`;

  function openItem(item: CalItem) {
    if (item.kind === "meeting" && item.meeting) setEditing(item.meeting);
    else if (item.task) setEditingTask(item.task);
  }

  async function toggleMeetingDone(m: Meeting) {
    const wasDone = Boolean((m as any).completed_at);
    const nextCompleted = wasDone ? null : new Date().toISOString();
    qc.setQueryData<Meeting[]>(["meetings"], (old) =>
      (old ?? []).map((x) => (x.id === m.id ? ({ ...x, completed_at: nextCompleted } as Meeting) : x)),
    );
    const { error } = await supabase
      .from("meetings")
      .update({ completed_at: nextCompleted })
      .eq("id", m.id);
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["meetings"] });
    }
  }

  async function toggleTaskDone(t: Task) {
    const wasDone = t.status === "done";
    const nextStatus = wasDone ? "todo" : "done";
    const nextCompleted = wasDone ? null : new Date().toISOString();
    qc.setQueryData<Task[]>(["tasks"], (old) =>
      (old ?? []).map((x) => (x.id === t.id ? ({ ...x, status: nextStatus, completed_at: nextCompleted } as Task) : x)),
    );
    const { error } = await supabase
      .from("tasks")
      .update({ status: nextStatus, completed_at: nextCompleted })
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      return;
    }
    const externalSystem = (t as any).external_system as string | null | undefined;
    const externalId = (t as any).external_id as string | null | undefined;
    if (externalSystem === "jira" && externalId) {
      void import("@/lib/jira.functions")
        .then(({ transitionJiraIssue }) => transitionJiraIssue({ data: { issueKey: externalId, status: nextStatus } }))
        .catch((e) => console.warn("Jira:", e));
    }
    if (externalSystem === "notion" && externalId) {
      void import("@/lib/notion.functions")
        .then(({ transitionNotionPage }) => transitionNotionPage({ data: { pageId: externalId, status: nextStatus } }))
        .catch((e) => console.warn("Notion:", e));
    }
    if (!wasDone) void spawnNextOccurrence(t).then(() => qc.invalidateQueries({ queryKey: ["tasks"] }));
  }

  /** Move uma tarefa para outro dia/horário (arrastar na grade). */
  async function moveTask(t: Task, targetKey: string, minutes: number | null) {
    const nextTime = minutes === null ? t.due_time ?? null : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
    if (t.due_date === targetKey && (t.due_time ?? null) === nextTime) return;
    qc.setQueryData<Task[]>(["tasks"], (old) =>
      (old ?? []).map((x) => (x.id === t.id ? ({ ...x, due_date: targetKey, due_time: nextTime } as Task) : x)),
    );
    const { error } = await supabase
      .from("tasks")
      .update({ due_date: targetKey, due_time: nextTime })
      .eq("id", t.id);
    if (error) {
      toast.error("Não movi: " + error.message);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      return;
    }
    const { syncTaskToCalendar } = await import("@/lib/task-calendar.functions");
    try {
      await syncTaskToCalendar({ data: { taskId: t.id } });
      toast.success("Tarefa movida (LUCK + Google)");
    } catch {
      toast.success("Tarefa movida");
    }
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }

  async function moveMeeting(
    m: Meeting & { google_event_id?: string | null; google_account?: string | null },
    targetKey: string,
    minutes: number | null,
    keepDuration = true,
  ) {
    const oldStart = new Date(m.starts_at);
    const [y, mo, d] = targetKey.split("-").map(Number);
    const newStart = new Date(oldStart);
    newStart.setFullYear(y, mo - 1, d);
    if (minutes !== null) newStart.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (newStart.getTime() === oldStart.getTime()) return;

    let newEndIso: string | null = null;
    if (m.ends_at && keepDuration) {
      const diff = new Date(m.ends_at).getTime() - oldStart.getTime();
      newEndIso = new Date(newStart.getTime() + diff).toISOString();
    }
    const newStartIso = newStart.toISOString();

    qc.setQueryData<Meeting[]>(["meetings"], (old) =>
      (old ?? []).map((x) =>
        x.id === m.id ? ({ ...x, starts_at: newStartIso, ends_at: newEndIso ?? x.ends_at } as Meeting) : x,
      ),
    );
    const { error } = await supabase
      .from("meetings")
      .update({ starts_at: newStartIso, ends_at: newEndIso ?? m.ends_at })
      .eq("id", m.id);
    if (error) {
      toast.error("Não movi: " + error.message);
      qc.invalidateQueries({ queryKey: ["meetings"] });
      return;
    }
    qc.invalidateQueries({ queryKey: ["meetings"] });

    if (m.google_event_id && m.google_account) {
      try {
        await moveGoogle({
          data: {
            googleAccount: m.google_account,
            googleEventId: m.google_event_id,
            startsAt: newStartIso,
            endsAt: newEndIso,
          },
        });
        toast.success("Evento movido (LUCK + Google)");
      } catch (e: any) {
        toast.error("Movi aqui mas não no Google: " + (e?.message ?? "erro"));
      }
    } else {
      toast.success("Evento movido");
    }
  }

  /** Aumenta/diminui a duração de uma reunião arrastando a borda de baixo. */
  async function resizeMeeting(m: Meeting & { google_event_id?: string | null; google_account?: string | null }, newDurationMin: number) {
    const start = new Date(m.starts_at);
    const endIso = new Date(start.getTime() + newDurationMin * 60000).toISOString();
    qc.setQueryData<Meeting[]>(["meetings"], (old) =>
      (old ?? []).map((x) => (x.id === m.id ? ({ ...x, ends_at: endIso } as Meeting) : x)),
    );
    const { error } = await supabase.from("meetings").update({ ends_at: endIso }).eq("id", m.id);
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["meetings"] });
      return;
    }
    if (m.google_event_id && m.google_account) {
      try {
        await moveGoogle({
          data: {
            googleAccount: m.google_account,
            googleEventId: m.google_event_id,
            startsAt: m.starts_at,
            endsAt: endIso,
          },
        });
      } catch {
        /* mantém local */
      }
    }
    qc.invalidateQueries({ queryKey: ["meetings"] });
  }

  function onDragStart(ev: React.DragEvent, item: CalItem, offsetMin = 0) {
    ev.dataTransfer.setData("text/luck-item", `${item.kind}:${item.id}`);
    ev.dataTransfer.effectAllowed = "move";
    grabOffset.current = offsetMin;
  }

  function onDragOver(ev: React.DragEvent, key: string) {
    if (ev.dataTransfer.types.includes("text/luck-item")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      if (dragOverKey !== key) setDragOverKey(key);
    }
  }

  function dropItem(raw: string, key: string, minutes: number | null) {
    const [kind, id] = raw.split(":");
    if (kind === "meeting") {
      const m = meetings.find((x) => x.id === id);
      if (m) moveMeeting(m as any, key, minutes);
    } else {
      const t = tasks.find((x) => x.id === id);
      if (t) moveTask(t, key, minutes);
    }
  }

  function onDropDay(ev: React.DragEvent, key: string) {
    const raw = ev.dataTransfer.getData("text/luck-item");
    setDragOverKey(null);
    if (raw) dropItem(raw, key, null);
  }

  /** Drop na grade de horas: calcula o horário pela posição do cursor. */
  function onDropGrid(ev: React.DragEvent, key: string) {
    const raw = ev.dataTransfer.getData("text/luck-item");
    setDragOverKey(null);
    if (!raw) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const y = ev.clientY - rect.top;
    let minutes = Math.round(((y / HOUR_H) * 60 - grabOffset.current) / 15) * 15;
    minutes = Math.max(0, Math.min(23 * 60 + 45, minutes));
    dropItem(raw, key, minutes);
  }

  /** Bloco colorido do compromisso — igual ao Google, com as cores da LUCK. */
  function ItemBlock({
    item,
    compact,
    absolute,
  }: {
    item: CalItem;
    compact?: boolean;
    absolute?: boolean;
  }) {
    const expanded = expandedId === item.id;
    const height = absolute ? (item.durationMin / 60) * HOUR_H : undefined;
    const small = absolute && item.durationMin <= 30;
    return (
      <div
        draggable
        onDragStart={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onDragStart(e, item, absolute ? ((e.clientY - rect.top) / HOUR_H) * 60 : 0);
        }}
        style={
          absolute
            ? {
                position: "absolute",
                top: ((item.startMin ?? 0) / 60) * HOUR_H,
                minHeight: expanded ? undefined : Math.max(22, height ?? 22),
                left: 2,
                right: 2,
                zIndex: expanded ? 20 : 10,
              }
            : undefined
        }
        className={`group cursor-grab rounded-md border px-2 py-1 text-left shadow-sm transition active:cursor-grabbing ${item.tint} ${
          item.done ? "opacity-60" : ""
        }`}
      >
        <div className="flex items-start gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (item.kind === "meeting" && item.meeting) toggleMeetingDone(item.meeting);
              else if (item.task) toggleTaskDone(item.task);
            }}
            aria-label="Marcar como concluído"
            className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border ${
              item.done ? "border-success bg-success text-success-foreground" : "border-foreground/30 bg-background/60"
            }`}
          >
            {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
          </button>
          <button
            onClick={() => setExpandedId(expanded ? null : item.id)}
            onDoubleClick={() => openItem(item)}
            className="min-w-0 flex-1 text-left"
          >
            <div className={`whitespace-pre-wrap break-words text-xs font-medium leading-tight ${item.done ? "line-through" : ""}`}>
              {item.title}
            </div>
            {!small && item.time && (
              <div className="text-[10px] tabular-nums opacity-75">
                {item.time}
                {item.durationMin && absolute
                  ? ` – ${pad(Math.floor(((item.startMin ?? 0) + item.durationMin) / 60) % 24)}:${pad(
                      ((item.startMin ?? 0) + item.durationMin) % 60,
                    )}`
                  : ""}
              </div>
            )}
            {!compact && !small && item.place && (
              <div className="mt-0.5 flex items-center gap-1 break-words text-[10px] opacity-70">
                <MapPin className="h-3 w-3" /> {item.place}
              </div>
            )}
          </button>
          {item.recurring && <Repeat className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />}
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
        </div>

        {expanded && (
          <div className="mt-1.5 border-t border-foreground/10 pt-1.5">
            {item.notes ? (
              <p className="whitespace-pre-wrap text-[11px] leading-relaxed opacity-80">{item.notes}</p>
            ) : (
              <p className="text-[11px] opacity-60">Sem notas.</p>
            )}
            <button
              onClick={() => openItem(item)}
              className="mt-1.5 rounded border border-foreground/20 bg-background/60 px-2 py-1 text-[11px] font-medium"
            >
              Abrir e editar
            </button>
          </div>
        )}

        {absolute && item.kind === "meeting" && item.meeting && !expanded && (
          <div
            role="separator"
            aria-label="Aumentar duração"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const startY = e.clientY;
              const startDur = item.durationMin;
              const el = e.currentTarget.parentElement as HTMLElement;
              const onMove = (ev: MouseEvent) => {
                const delta = Math.round((((ev.clientY - startY) / HOUR_H) * 60) / 15) * 15;
                const next = Math.max(15, startDur + delta);
                el.style.height = `${(next / 60) * HOUR_H}px`;
              };
              const onUp = (ev: MouseEvent) => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                const delta = Math.round((((ev.clientY - startY) / HOUR_H) * 60) / 15) * 15;
                const next = Math.max(15, startDur + delta);
                if (next !== startDur && item.meeting) resizeMeeting(item.meeting as any, next);
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }}
            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition group-hover:opacity-100"
          >
            <div className="mx-auto h-1 w-8 rounded-full bg-foreground/30" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold tracking-tight">Calendário</h1>
          <SyncGoogleButton />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1 rounded-md border p-0.5 text-xs">
            {(["day", "2day", "5day", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex-1 rounded px-2 py-1.5 ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                {v === "day" ? "Dia" : v === "2day" ? "2 dias" : v === "5day" ? "5 dias" : "Mês"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCursor(new Date())}
            className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
          >
            Hoje
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button aria-label="Anterior" onClick={() => shift(-1)} className="rounded-md border p-2 hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 text-center text-sm font-medium capitalize">{headerLabel}</span>
          <button aria-label="Próximo" onClick={() => shift(1)} className="rounded-md border p-2 hover:bg-accent">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1 ${filter === "all" ? "border-foreground font-medium" : "text-muted-foreground"}`}
        >
          Todas
        </button>
        {visibleSources.map((s) => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${filter === s.key ? "border-foreground font-medium" : "text-muted-foreground"}`}
          >
            <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[s.key]}`} />
            {s.label}
          </button>
        ))}
      </div>

      {view === "month" ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-7 border-b text-center text-[11px] text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((d) => {
              const key = fmtKey(d);
              const items = itemsFor(key);
              const muted = d.getMonth() !== cursor.getMonth();
              return (
                <div
                  key={key}
                  onDragOver={(e) => onDragOver(e, key)}
                  onDragLeave={() => dragOverKey === key && setDragOverKey(null)}
                  onDrop={(e) => onDropDay(e, key)}
                  className={`min-h-20 border-b border-r p-1.5 last:border-r-0 ${muted ? "bg-secondary/30" : ""} ${dragOverKey === key ? "bg-accent" : ""}`}
                >
                  <span
                    className={`text-[11px] ${
                      key === todayKey
                        ? "rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground"
                        : muted
                          ? "text-muted-foreground"
                          : ""
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {items.slice(0, 3).map((i) => (
                      <ItemBlock key={i.id} item={i} compact />
                    ))}
                    {items.length > 3 && (
                      <span className="text-[10px] text-muted-foreground">+{items.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {/* Cabeçalho dos dias */}
          <div
            className="grid border-b text-center text-[11px] text-muted-foreground"
            style={{ gridTemplateColumns: `48px repeat(${rangeDays.length}, minmax(0, 1fr))` }}
          >
            <div />
            {rangeDays.map((d) => {
              const key = fmtKey(d);
              const isToday = key === todayKey;
              return (
                <div key={key} className="py-2">
                  <div>{d.toLocaleDateString("pt-BR", { weekday: "short" })}</div>
                  <div
                    className={`mx-auto mt-0.5 inline-block text-sm font-medium ${
                      isToday ? "rounded-full bg-primary px-2 py-0.5 text-primary-foreground" : "text-foreground"
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {undatedTasks.length > 0 && (
            <div className="flex flex-wrap items-start gap-1 border-b bg-secondary/40 p-1.5">
              <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">sem data</span>
              {undatedTasks.map((t) => (
                <div key={t.id} className="w-52 max-w-full">
                  <ItemBlock item={taskItem(t)} compact />
                </div>
              ))}
            </div>
          )}

          {/* Faixa de dia inteiro (sem horário) */}
          <div
            className="grid border-b bg-secondary/20"
            style={{ gridTemplateColumns: `48px repeat(${rangeDays.length}, minmax(0, 1fr))` }}
          >
            <div className="py-1 pr-1 text-right text-[10px] text-muted-foreground">dia</div>
            {rangeDays.map((d) => {
              const key = fmtKey(d);
              const allDay = itemsFor(key).filter((i) => i.startMin === null);
              return (
                <div
                  key={key}
                  onDragOver={(e) => onDragOver(e, `allday-${key}`)}
                  onDragLeave={() => dragOverKey === `allday-${key}` && setDragOverKey(null)}
                  onDrop={(e) => onDropDay(e, key)}
                  className={`min-h-[34px] space-y-1 border-r p-1 last:border-r-0 ${dragOverKey === `allday-${key}` ? "bg-accent/60" : ""}`}
                >
                  {allDay.map((i) => (
                    <ItemBlock key={i.id} item={i} compact />
                  ))}
                  <button
                    onClick={() => setNewMeetingDay(key)}
                    className="flex w-full items-center justify-center gap-1 rounded border border-dashed py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                  >
                    <Plus className="h-3 w-3" /> Novo
                  </button>
                </div>
              );
            })}
          </div>

          {/* Grade de horas */}
          <div ref={gridRef} className="max-h-[70vh] overflow-y-auto">
            <div
              className="relative grid"
              style={{ gridTemplateColumns: `48px repeat(${rangeDays.length}, minmax(0, 1fr))` }}
            >
              {/* coluna das horas */}
              <div className="relative" style={{ height: 24 * HOUR_H }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                    style={{ top: h * HOUR_H }}
                  >
                    {h === 0 ? "" : `${pad(h)}:00`}
                  </div>
                ))}
              </div>

              {rangeDays.map((d) => {
                const key = fmtKey(d);
                const timed = itemsFor(key).filter((i) => i.startMin !== null);
                const isToday = key === todayKey;
                return (
                  <div
                    key={key}
                    onDragOver={(e) => onDragOver(e, key)}
                    onDragLeave={() => dragOverKey === key && setDragOverKey(null)}
                    onDrop={(e) => onDropGrid(e, key)}
                    onDoubleClick={() => setNewMeetingDay(key)}
                    className={`relative border-r last:border-r-0 ${dragOverKey === key ? "bg-accent/40" : ""}`}
                    style={{ height: 24 * HOUR_H }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-border/60"
                        style={{ top: h * HOUR_H }}
                      />
                    ))}
                    {isToday && (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
                        style={{ top: (nowMin / 60) * HOUR_H }}
                      >
                        <span className="-ml-1 h-2 w-2 rounded-full bg-reuniao" />
                        <span className="h-px flex-1 bg-reuniao" />
                      </div>
                    )}
                    {timed.map((i) => (
                      <ItemBlock key={i.id} item={i} absolute />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {editing && <MeetingEditModal meeting={editing} onClose={() => setEditing(null)} />}
      {editingTask && <TaskEditModal task={editingTask} onClose={() => setEditingTask(null)} />}
      {newMeetingDay && <NewMeetingModal defaultDate={newMeetingDay} onClose={() => setNewMeetingDay(null)} />}
    </div>
  );
}
