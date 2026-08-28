import { useMemo, useState } from "react";
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


function fmtKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type CalItem = {
  kind: "meeting" | "task";
  id: string;
  title: string;
  dot: string;
  tint: string;
  time: string | null;
  sortKey: string;
  notes: string | null;
  place: string | null;
  recurring: boolean;
  done: boolean;
  meeting?: Meeting;
  task?: Task;
};

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const { visibleSources } = useArchivedSources();
  const qc = useQueryClient();
  const moveGoogle = useServerFn(moveGoogleEvent);


  const todayKey = fmtKey(new Date());

  const visibleMeetings = filter === "all" ? meetings : meetings.filter((m) => m.source === filter);
  const visibleTasks = filter === "all" ? tasks : tasks.filter((t) => t.source === filter);

  function itemsFor(key: string): CalItem[] {
    const items: CalItem[] = [
      ...visibleMeetings
        .filter((m) => fmtKey(new Date(m.starts_at)) === key)
        .map<CalItem>((m) => {
          const isMeeting = m.meeting_type === "Reunião";
          return {
            kind: "meeting",
            id: m.id,
            title: m.title,
            dot: isMeeting ? "bg-reuniao" : SOURCE_DOT[m.source],
            tint: isMeeting ? "bg-reuniao-soft border-reuniao/40" : SOURCE_TINT[m.source],
            time: hhmm(m.starts_at),
            sortKey: hhmm(m.starts_at),
            notes: m.notes ?? null,
            place: m.location ?? null,
            recurring: false,
            done: Boolean(m.completed_at),
            meeting: m,
          };
        }),
      ...visibleTasks
        .filter((t) => t.due_date === key)
        .map<CalItem>((t) => ({
          kind: "task",
          id: t.id,
          title: t.title,
          dot: SOURCE_DOT[t.source],
          tint: SOURCE_TINT[t.source],
          time: t.due_time ? t.due_time.slice(0, 5) : null,
          sortKey: t.due_time ? t.due_time.slice(0, 5) : "99:99",
          notes: t.notes ?? null,
          place: null,
          recurring: Boolean(t.recurrence && t.recurrence !== "none"),
          done: t.status === "done",
          task: t,
        })),
    ];
    return items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }



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
    // Sincroniza com Jira/Notion se aplicável
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
    // Tarefa recorrente concluída → já cria a próxima ocorrência.
    if (!wasDone) void spawnNextOccurrence(t).then(() => qc.invalidateQueries({ queryKey: ["tasks"] }));
  }

  /** Move uma tarefa para outro dia (arrastar no calendário). */
  async function moveTaskToDate(t: Task, targetKey: string) {
    if (t.due_date === targetKey) return;
    qc.setQueryData<Task[]>(["tasks"], (old) =>
      (old ?? []).map((x) => (x.id === t.id ? ({ ...x, due_date: targetKey } as Task) : x)),
    );
    const { error } = await supabase.from("tasks").update({ due_date: targetKey }).eq("id", t.id);
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



  async function moveMeetingToDate(m: Meeting & { google_event_id?: string | null; google_account?: string | null }, targetKey: string) {
    const oldStart = new Date(m.starts_at);
    const [y, mo, d] = targetKey.split("-").map(Number);
    const newStart = new Date(oldStart);
    newStart.setFullYear(y, mo - 1, d);
    if (fmtKey(newStart) === fmtKey(oldStart)) return;
    let newEndIso: string | null = null;
    if (m.ends_at) {
      const oldEnd = new Date(m.ends_at);
      const diff = oldEnd.getTime() - oldStart.getTime();
      newEndIso = new Date(newStart.getTime() + diff).toISOString();
    }
    const newStartIso = newStart.toISOString();

    // Otimista: atualiza local primeiro.
    const { error } = await supabase
      .from("meetings")
      .update({ starts_at: newStartIso, ends_at: newEndIso ?? m.ends_at })
      .eq("id", m.id);
    if (error) {
      toast.error("Não movi: " + error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["meetings"] });

    // Se veio do Google, empurra pra lá pra próxima sync não desfazer.
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

  function onDragStart(ev: React.DragEvent, item: CalItem) {
    ev.dataTransfer.setData("text/luck-item", `${item.kind}:${item.id}`);
    ev.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(ev: React.DragEvent, key: string) {
    if (ev.dataTransfer.types.includes("text/luck-item")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      if (dragOverKey !== key) setDragOverKey(key);
    }
  }
  function onDrop(ev: React.DragEvent, key: string) {
    const raw = ev.dataTransfer.getData("text/luck-item");
    setDragOverKey(null);
    if (!raw) return;
    const [kind, id] = raw.split(":");
    if (kind === "meeting") {
      const m = meetings.find((x) => x.id === id);
      if (m) moveMeetingToDate(m as any, key);
    } else {
      const t = tasks.find((x) => x.id === id);
      if (t) moveTaskToDate(t, key);
    }
  }

  /** Bloco colorido do compromisso — igual ao Google, mas com as cores da LUCK. */
  function ItemBlock({ item, compact }: { item: CalItem; compact?: boolean }) {
    const expanded = expandedId === item.id;
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, item)}
        className={`group rounded-md border px-2 py-1.5 text-left transition ${item.tint} ${
          item.done ? "opacity-60" : ""
        }`}
      >
        <div className="flex items-start gap-2">
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
            <div className={`truncate text-xs font-medium ${item.done ? "line-through" : ""}`}>
              {item.time && <span className="mr-1 tabular-nums opacity-70">{item.time}</span>}
              {item.title}
            </div>
            {!compact && item.place && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] opacity-70">
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
          <button
            aria-label="Anterior"
            onClick={() => shift(-1)}
            className="rounded-md border p-2 hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 text-center text-sm font-medium capitalize">{headerLabel}</span>
          <button
            aria-label="Próximo"
            onClick={() => shift(1)}
            className="rounded-md border p-2 hover:bg-accent"
          >
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
                  onDrop={(e) => onDrop(e, key)}
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
                      <span className="text-[10px] text-muted-foreground">
                        +{items.length - 3}
                      </span>
                    )}
                  </div>

                </div>
              );

            })}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div
            className="grid border-b text-center text-[11px] text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${rangeDays.length}, minmax(0, 1fr))` }}
          >
            {rangeDays.map((d) => {
              const key = fmtKey(d);
              const isToday = key === todayKey;
              return (
                <div key={key} className="py-2">
                  <div>{d.toLocaleDateString("pt-BR", { weekday: "short" })}</div>
                  <div
                    className={`mx-auto mt-0.5 inline-block text-sm font-medium ${
                      isToday
                        ? "rounded-full bg-primary px-2 py-0.5 text-primary-foreground"
                        : "text-foreground"
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${rangeDays.length}, minmax(0, 1fr))` }}
          >
            {rangeDays.map((d) => {
              const key = fmtKey(d);
              const items = itemsFor(key);
              return (
                <div
                  key={key}
                  onDragOver={(e) => onDragOver(e, key)}
                  onDragLeave={() => dragOverKey === key && setDragOverKey(null)}
                  onDrop={(e) => onDrop(e, key)}
                  className={`min-h-[60vh] space-y-1 border-r p-2 last:border-r-0 ${dragOverKey === key ? "bg-accent/60" : ""}`}
                >
                  {items.length === 0 && (
                    <div className="pt-4 text-center text-[11px] text-muted-foreground">
                      Sem itens
                    </div>
                  )}
                  {items.map((i) => {
                    const done = i.kind === "meeting"
                      ? Boolean((i.meeting as any).completed_at)
                      : i.task.status === "done";
                    return (
                      <div
                        key={i.id}
                        className="flex w-full min-w-0 items-start gap-1.5 overflow-hidden rounded-md border bg-background p-1.5"
                      >
                        <button
                          draggable={i.kind === "meeting"}
                          onDragStart={(e) => i.kind === "meeting" && onDragStart(e, i.id)}
                          onClick={() => openItem(i)}
                          className="flex min-w-0 flex-1 items-start gap-1.5 text-left hover:bg-accent/60 rounded"
                        >
                          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i.dot}`} />
                          <span className="min-w-0 flex-1 break-words text-xs leading-tight">
                            {i.title}
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (i.kind === "meeting") toggleMeetingDone(i.meeting);
                            else toggleTaskDone(i.task);
                          }}
                          aria-label={done ? "Desmarcar" : "Marcar concluído"}
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-emerald-500"
                          }`}
                        >
                          {done && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}


      {editing && <MeetingEditModal meeting={editing} onClose={() => setEditing(null)} />}
      {editingTask && <TaskEditModal task={editingTask} onClose={() => setEditingTask(null)} />}

    </div>
  );
}
