import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { SyncGoogleButton } from "@/components/SyncGoogleButton";
import { MeetingEditModal } from "@/components/MeetingEditModal";
import { TaskEditModal } from "@/components/TaskEditModal";
import { useMeetings, useTasks } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { moveGoogleEvent } from "@/lib/gcal.functions";
import { SOURCE_DOT, type Meeting, type SourceKey, type Task } from "@/lib/sources";
import { useArchivedSources } from "@/lib/archived-sources";



export const Route = createFileRoute("/_authenticated/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário · Anora" },
      {
        name: "description",
        content: "Visão diária, 5 dias ou mensal com tarefas e reuniões de todas as empresas.",
      },
      { property: "og:title", content: "Calendário · Anora" },
      { property: "og:description", content: "Visão diária, 5 dias ou mensal de tarefas e reuniões." },
    ],
  }),
  component: CalendarPage,
});

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
type ViewMode = "day" | "5day" | "month";

function fmtKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type CalItem =
  | { kind: "meeting"; id: string; title: string; dot: string; meeting: Meeting }
  | { kind: "task"; id: string; title: string; dot: string; task: Task };


function CalendarPage() {
  const [view, setView] = useState<ViewMode>("month");
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
    return [
      ...visibleMeetings
        .filter((m) => m.starts_at.slice(0, 10) === key)
        .map<CalItem>((m) => ({
          kind: "meeting",
          id: m.id,
          title: m.title,
          // Reunião de verdade fica vermelho; senão usa a cor da empresa.
          dot: m.meeting_type === "Reunião" ? "bg-reuniao" : SOURCE_DOT[m.source],
          meeting: m,
        })),
      ...visibleTasks
        .filter((t) => t.due_date === key)
        .map<CalItem>((t) => ({ kind: "task", id: t.id, title: t.title, dot: SOURCE_DOT[t.source], task: t })),
    ];
  }


  function shift(dir: -1 | 1) {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "5day") d.setDate(d.getDate() + dir * 5);
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
    const n = view === "day" ? 1 : 5;
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
            cursor.getDate() + 4,
          ).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}`;

  function openItem(item: CalItem) {
    if (item.kind === "meeting") setEditing(item.meeting);
    else setEditingTask(item.task);
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
        toast.success("Evento movido (Anora + Google)");
      } catch (e: any) {
        toast.error("Movi aqui mas não no Google: " + (e?.message ?? "erro"));
      }
    } else {
      toast.success("Evento movido");
    }
  }

  function onDragStart(ev: React.DragEvent, itemId: string) {
    ev.dataTransfer.setData("text/anora-meeting", itemId);
    ev.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(ev: React.DragEvent, key: string) {
    if (ev.dataTransfer.types.includes("text/anora-meeting")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      if (dragOverKey !== key) setDragOverKey(key);
    }
  }
  function onDrop(ev: React.DragEvent, key: string) {
    const id = ev.dataTransfer.getData("text/anora-meeting");
    setDragOverKey(null);
    if (!id) return;
    const m = meetings.find((x) => x.id === id);
    if (m) moveMeetingToDate(m as any, key);
  }


  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Calendário</h1>
        <div className="flex rounded-md border p-0.5 text-xs">
          {(["day", "5day", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2 py-1 ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {v === "day" ? "Dia" : v === "5day" ? "5 dias" : "Mês"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCursor(new Date())}
          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          Hoje
        </button>
        <SyncGoogleButton />
        <button
          aria-label="Anterior"
          onClick={() => shift(-1)}
          className="rounded-md border p-1.5 hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-40 text-center text-sm font-medium capitalize">{headerLabel}</span>
        <button
          aria-label="Próximo"
          onClick={() => shift(1)}
          className="rounded-md border p-1.5 hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
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
                  <div className="mt-1 space-y-0.5">
                    {items.slice(0, 3).map((i) => (
                      <button
                        key={i.id}
                        draggable={i.kind === "meeting"}
                        onDragStart={(e) => i.kind === "meeting" && onDragStart(e, i.id)}
                        onClick={() => openItem(i)}
                        className="flex w-full items-center gap-1 rounded px-0.5 text-left hover:bg-accent/60"
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${i.dot}`} />
                        <span className="truncate text-[10px] text-muted-foreground">{i.title}</span>
                      </button>
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
                  {items.map((i) => (
                    <button
                      key={i.id}
                      draggable={i.kind === "meeting"}
                      onDragStart={(e) => i.kind === "meeting" && onDragStart(e, i.id)}
                      onClick={() => openItem(i)}
                      className="flex w-full min-w-0 items-start gap-1.5 overflow-hidden rounded-md border bg-background p-1.5 text-left hover:bg-accent/60"
                    >
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i.dot}`} />
                      <span className="min-w-0 flex-1 break-words text-xs leading-tight">{i.title}</span>
                    </button>
                  ))}
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
