import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronLeft, ChevronRight, Check, Plus, Repeat, MapPin, Pencil } from "lucide-react";
import { deleteTaskEverywhere } from "@/lib/delete-task";
import { toast } from "sonner";
import { SyncGoogleButton } from "@/components/SyncGoogleButton";
import { MeetingEditModal } from "@/components/MeetingEditModal";
import { TaskEditModal } from "@/components/TaskEditModal";
import { NewMeetingModal } from "@/components/NewMeetingModal";
import { NewTaskModal } from "@/components/NewTaskModal";
import { useMeetings, useTasks } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { moveGoogleEvent, patchGoogleEvent } from "@/lib/gcal.functions";
import { spawnNextOccurrence } from "@/lib/recurrence";
import { SOURCE_TINT, SOURCE_DOT, STATUS_LABEL, type Meeting, type SourceKey, type Task } from "@/lib/sources";
import { useArchivedSources } from "@/lib/archived-sources";
import { useIsMobile } from "@/hooks/use-mobile";
import { allDayRange, isAllDay, meetingDateKey } from "@/lib/all-day";

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
type ViewMode = "day" | "week" | "2day" | "5day" | "month";

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
  /** Só reuniões reais usam o vermelho forte; compromissos comuns seguem a empresa. */
  meetingColor?: boolean;
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
  /** Estado da tarefa quando não é "a fazer"/"concluída" (ex.: Em andamento, Em espera). */
  statusLabel?: string;
  meeting?: Meeting;
  task?: Task;
};

function hhmm(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Dia atual do item, no formato do input de data. */
function itemDateKey(item: CalItem) {
  if (item.kind === "meeting" && item.meeting) return meetingDateKey(item.meeting);
  return item.task?.due_date ?? fmtKey(new Date());
}


/**
 * Cartãozinho de edição rápida dentro do próprio bloco — estilo Google Agenda.
 * Permite mudar nome, dia e horário sem abrir nenhuma janela.
 */
function QuickEdit({
  item,
  dateKey,
  onSave,
  onDelete,
  onMore,
  onClose,
}: {
  item: CalItem;
  dateKey: string;
  onSave: (v: { title: string; date: string; time: string | null }) => void;
  onDelete: () => void;
  onMore: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(dateKey);
  const [time, setTime] = useState(item.time ?? "");

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.stopPropagation()}
      className="mt-1.5 space-y-1.5 rounded-md border border-foreground/15 bg-background/95 p-1.5 shadow-md"
    >
      <textarea
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        rows={2}
        className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[11px]"
        placeholder="Nome"
      />
      <div className="flex gap-1">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-w-0 flex-1 rounded border bg-background px-1 py-1 text-[11px]"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-[74px] rounded border bg-background px-1 py-1 text-[11px]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => {
            if (!title.trim()) return;
            onSave({ title: title.trim(), date, time: time || null });
            onClose();
          }}
          className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
        >
          Salvar
        </button>
        <button onClick={onClose} className="rounded border px-2 py-1 text-[11px]">
          Cancelar
        </button>
        <button
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="rounded border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
        >
          Excluir
        </button>
        <button onClick={onMore} className="ml-auto rounded px-1.5 py-1 text-[11px] underline opacity-70">
          Mais opções
        </button>
      </div>
    </div>
  );
}


function CalendarPage() {
  // Abre sempre na visão de 5 dias — é a que a Ana usa no dia a dia.
  // Ao voltar para a agenda (vindo de outra tela), mantém dia, visão e filtro
  // dessa sessão. Na primeira abertura, começa em 5 dias, hoje.
  const saved = (() => {
    try {
      const raw = typeof window !== "undefined" ? window.sessionStorage.getItem("luck.cal.state") : null;
      return raw ? (JSON.parse(raw) as { view?: ViewMode; cursor?: string; filter?: SourceKey | "all" }) : null;
    } catch {
      return null;
    }
  })();
  const [view, setView] = useState<ViewMode>(
    saved?.view === "day" || saved?.view === "month" ? saved.view : "week",
  );
  const isMobile = useIsMobile();
  const [cursor, setCursor] = useState(() => {
    if (saved?.cursor) {
      const [y, m, dd] = saved.cursor.split("-").map(Number);
      if (y && m && dd) return new Date(y, m - 1, dd);
    }
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const [filter, setFilter] = useState<SourceKey | "all">(saved?.filter ?? "all");
  // Faixa "Sem horário" recolhível (lembra a escolha neste navegador).
  const [stripOpen, setStripOpen] = useState(true);
  // Concluídos da faixa "Sem horário": recolhidos por padrão, para não ocupar a tela.
  const [doneOpen, setDoneOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("luck.cal.done") === "1") setDoneOpen(true);
      if (window.localStorage.getItem("luck.cal.strip") === "0") setStripOpen(false);
    } catch {
      /* sem armazenamento: segue aberta */
    }
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        "luck.cal.state",
        JSON.stringify({ view, filter, cursor: fmtKey(cursor) }),
      );
    } catch {
      /* ignora */
    }
  }, [view, filter, cursor]);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Bloco em edição rápida (lápis no canto do cartão). */
  const [quickId, setQuickId] = useState<string | null>(null);

  const [newMeetingDay, setNewMeetingDay] = useState<string | null>(null);
  const [newTaskAt, setNewTaskAt] = useState<{ date: string; time: string | null } | null>(null);
  const [newMeetingTime, setNewMeetingTime] = useState<string | null>(null);
  /** Escolha "Tarefa ou Reunião?" ao clicar duas vezes / no botão Novo. */
  const [chooser, setChooser] = useState<{ date: string; time: string | null } | null>(null);

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
  const patchGoogle = useServerFn(patchGoogleEvent);


  const todayKey = fmtKey(new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Abre a grade já rolada para a hora atual.
  useEffect(() => {
    if (view === "month" || scrolled.current || !gridRef.current) return;
    gridRef.current.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_H);
    scrolled.current = true;
  }, [view, isMobile]);

  // Atalho T = voltar para hoje.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "t" || e.key === "T") {
        const d = new Date();
        setCursor(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleMeetings = filter === "all" ? meetings : meetings.filter((m) => m.source === filter);
  const visibleTasks = filter === "all" ? tasks : tasks.filter((t) => t.source === filter);

  function itemsFor(key: string): CalItem[] {
    const items: CalItem[] = [
      ...visibleMeetings
        .filter((m) => meetingDateKey(m) === key)
        .map<CalItem>((m) => {
          const start = new Date(m.starts_at);
          const allDayItem = isAllDay(m);
          // Dia inteiro não tem horário: vai para a faixa "sem horário", sem 21:00 inventado.
          const startMin = allDayItem ? null : start.getHours() * 60 + start.getMinutes();
          // Regra da Angi: tudo que entrou como compromisso da agenda Angi fica
          // vermelho. Tarefas comuns da Angi continuam verdes, pois são CalItem task.
          const fromAngiCalendar = m.google_account?.toLowerCase().includes("angisaude.com") === true;
          const meetingColor =
            fromAngiCalendar ||
            m.source === "angi" ||
            m.is_meeting === true ||
            m.meeting_type?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ===
              "reuniao";
          const durationMin = m.ends_at
            ? Math.max(20, Math.round((new Date(m.ends_at).getTime() - start.getTime()) / 60000))
            : DEFAULT_MEETING_MIN;
          return {
            kind: "meeting",
            meetingColor,
            id: m.id,
            title: m.title,
            // Reuniões (e compromissos importados da Angi) usam vermelho forte.
            dot: meetingColor ? "bg-reuniao" : SOURCE_DOT[m.source],
            tint: meetingColor ? "bg-reuniao/35 border-reuniao/70" : SOURCE_TINT[m.source],
            startMin,
            durationMin,
            time: allDayItem ? null : hhmm(m.starts_at),
            notes: m.notes ?? null,
            place: m.location ?? null,
            recurring: false,
            done: Boolean(m.completed_at) || (m as any).status === "done",
            meeting: m,
          };
        }),
      ...visibleTasks.filter((t) => t.due_date === key).map<CalItem>(taskItem),
    ];
    // Concluídos (check) descem para o fim da fila. Quem NÃO está concluído
    // mantém a ordem do dia: primeiro o que é de dia inteiro, depois o que tem
    // horário, do mais cedo para o mais tarde. Entre os concluídos vale a mesma
    // ordem, só que depois de todos os pendentes.
    return items.sort((a, b) => {
      if (a.done !== b.done) return Number(a.done) - Number(b.done);
      const aTimed = a.startMin !== null;
      const bTimed = b.startMin !== null;
      if (aTimed !== bTimed) return aTimed ? 1 : -1;
      if (!aTimed || !bTimed) return 0;
      return (a.startMin as number) - (b.startMin as number);
    });
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
      durationMin: (t as unknown as { duration_min?: number | null }).duration_min ?? DEFAULT_TASK_MIN,
      time: hm,
      notes: t.notes ?? null,
      place: null,
      recurring: Boolean(t.recurrence && t.recurrence !== "none"),
      done: t.status === "done",
      statusLabel: t.status === "doing" || t.status === "onhold" ? STATUS_LABEL[t.status] : undefined,
      task: t,
    };
  }

  /** Tarefas ainda sem data — ficam numa faixa própria para não sumirem. */
  const undatedTasks = visibleTasks.filter((t) => !t.due_date && t.status !== "done");


  // No celular a grade é sempre de um dia (com a faixa da semana em cima).
  const effView: ViewMode = isMobile && view !== "month" ? "day" : view;

  function shift(dir: -1 | 1) {
    const d = new Date(cursor);
    if (effView === "month") d.setMonth(d.getMonth() + dir);
    else if (effView === "week") d.setDate(d.getDate() + dir * 7);
    else if (effView === "5day") d.setDate(d.getDate() + dir * 5);
    else if (effView === "2day") d.setDate(d.getDate() + dir * 2);
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

  /** Mini mês da lateral (sempre do mês do cursor). */
  const miniDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  /** Semana (seg–dom) do cursor — usada na faixa do celular e no destaque do mini mês. */
  const weekDays = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);
  const weekKeys = new Set(weekDays.map(fmtKey));

  const rangeDays = useMemo(() => {
    if (effView === "month") return [];
    if (effView === "week") return weekDays;
    const n = effView === "day" ? 1 : effView === "2day" ? 2 : 5;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + i);
      return d;
    });
  }, [cursor, effView, weekDays]);

  const headerLabel =
    effView === "month"
      ? cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : effView === "day"
        ? cursor.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
        : `${rangeDays[0].getDate()} – ${rangeDays[rangeDays.length - 1].toLocaleDateString("pt-BR", {
            day: "numeric",
            month: "long",
          })}`;

  function openItem(item: CalItem) {
    if (item.kind === "meeting" && item.meeting) setEditing(item.meeting);
    else if (item.task) setEditingTask(item.task);
  }

  async function toggleMeetingDone(m: Meeting) {
    const wasDone = Boolean((m as any).completed_at) || (m as any).status === "done";
    const nextCompleted = wasDone ? null : new Date().toISOString();
    const nextStatus = wasDone ? "todo" : "done";
    qc.setQueryData<Meeting[]>(["meetings"], (old) =>
      (old ?? []).map((x) =>
        x.id === m.id ? ({ ...x, completed_at: nextCompleted, status: nextStatus } as Meeting) : x,
      ),
    );
    // Marcar concluído no calendário move o card para "Concluída" na aba Tarefas.
    const { error } = await supabase
      .from("meetings")
      .update({ completed_at: nextCompleted, status: nextStatus })
      .eq("id", m.id);
    if (error) {
      toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["meetings"] });
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
      .update({ due_date: targetKey, start_date: targetKey, due_time: nextTime, locally_managed: true })
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
    let newStart: Date;
    let newEndIso: string | null = null;
    if (isAllDay(m) && minutes === null) {
      // Dia inteiro movido para outro dia: continua dia inteiro (sem 21:00).
      if (meetingDateKey(m) === targetKey) return;
      const r = allDayRange(targetKey);
      newStart = new Date(r.starts_at);
      newEndIso = r.ends_at;
    } else {
      const [y, mo, d] = targetKey.split("-").map(Number);
      newStart = new Date(oldStart);
      newStart.setFullYear(y, mo - 1, d);
      if (minutes !== null) newStart.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      if (newStart.getTime() === oldStart.getTime()) return;
      if (m.ends_at && keepDuration && !isAllDay(m)) {
        const diff = new Date(m.ends_at).getTime() - oldStart.getTime();
        newEndIso = new Date(newStart.getTime() + diff).toISOString();
      }
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
            allDay: isAllDay({ starts_at: newStartIso, ends_at: newEndIso }),
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

  /** Aumenta/diminui quanto tempo a tarefa ocupa no calendário. */
  async function resizeTask(t: Task, newDurationMin: number) {
    qc.setQueryData<Task[]>(["tasks"], (old) =>
      (old ?? []).map((x) =>
        x.id === t.id ? ({ ...x, duration_min: newDurationMin } as unknown as Task) : x,
      ),
    );
    const { error } = await supabase
      .from("tasks")
      .update({ duration_min: newDurationMin } as never)
      .eq("id", t.id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }

  /**
   * Salva nome/dia/horário direto no cartão, sem abrir janela.
   * A tela muda na hora; o envio ao banco e ao Google acontece em segundo plano.
   */
  function saveQuick(item: CalItem, v: { title: string; date: string; time: string | null }) {
    if (item.kind === "task" && item.task) {
      const t = item.task;
      const dueTime = v.time ? `${v.time}:00` : null;
      qc.setQueryData<Task[]>(["tasks"], (old) =>
        (old ?? []).map((x) =>
          x.id === t.id
            ? ({ ...x, title: v.title, due_date: v.date, start_date: v.date, due_time: dueTime } as Task)
            : x,
        ),
      );
      void (async () => {
        const { error } = await supabase
          .from("tasks")
          .update({
            title: v.title,
            due_date: v.date,
            start_date: v.date,
            due_time: dueTime,
            locally_managed: true,
          } as never)
          .eq("id", t.id);
        if (error) {
          toast.error(error.message);
          qc.invalidateQueries({ queryKey: ["tasks"] });
          return;
        }
        try {
          const { syncTaskToCalendar } = await import("@/lib/task-calendar.functions");
          await syncTaskToCalendar({ data: { taskId: t.id } });
        } catch {
          /* mantém local */
        }
        qc.invalidateQueries({ queryKey: ["tasks"] });
      })();
      return;
    }

    const m = item.meeting as (Meeting & { google_event_id?: string | null; google_account?: string | null }) | undefined;
    if (!m) return;
    const oldStart = new Date(m.starts_at);
    let startIso: string;
    let endIso = m.ends_at ?? null;
    if (isAllDay(m) && !v.time) {
      const r = allDayRange(v.date);
      startIso = r.starts_at;
      endIso = r.ends_at;
    } else {
      const [y, mo, d] = v.date.split("-").map(Number);
      const newStart = new Date(oldStart);
      newStart.setFullYear(y, mo - 1, d);
      if (v.time) {
        const [h, mi] = v.time.split(":").map(Number);
        newStart.setHours(h, mi, 0, 0);
      }
      startIso = newStart.toISOString();
      if (m.ends_at && !isAllDay(m)) {
        const diff = new Date(m.ends_at).getTime() - oldStart.getTime();
        endIso = new Date(newStart.getTime() + diff).toISOString();
      } else if (isAllDay(m) && v.time) {
        endIso = new Date(newStart.getTime() + 60 * 60 * 1000).toISOString();
      }
    }
    qc.setQueryData<Meeting[]>(["meetings"], (old) =>
      (old ?? []).map((x) =>
        x.id === m.id ? ({ ...x, title: v.title, starts_at: startIso, ends_at: endIso } as Meeting) : x,
      ),
    );
    void (async () => {
      const { error } = await supabase
        .from("meetings")
        .update({ title: v.title, starts_at: startIso, ends_at: endIso })
        .eq("id", m.id);
      if (error) {
        toast.error(error.message);
        qc.invalidateQueries({ queryKey: ["meetings"] });
        return;
      }
      if (m.google_event_id && m.google_account) {
        try {
          await patchGoogle({
            data: {
              googleAccount: m.google_account,
              googleEventId: m.google_event_id,
              title: v.title,
              startsAt: startIso,
              notes: m.notes ?? null,
              allDay: isAllDay({ starts_at: startIso, ends_at: endIso }),
            },
          });
        } catch {
          toast.error("Salvo na LUCK, mas não sincronizou com o Google");
        }
      }
      qc.invalidateQueries({ queryKey: ["meetings"] });
    })();
  }

  /** Exclui o compromisso direto do cartão (some na hora da tela). */
  function deleteQuick(item: CalItem) {
    const what = item.kind === "task" ? "tarefa" : "compromisso";
    if (!window.confirm(`Excluir ${what} "${item.title}"? Se ele estiver no Google Agenda, será apagado de lá também.`)) {
      return;
    }
    if (item.kind === "task" && item.task) {
      const id = item.task.id;
      qc.setQueryData<Task[]>(["tasks"], (old) => (old ?? []).filter((x) => x.id !== id));
      void (async () => {
        try {
          const r = await deleteTaskEverywhere(id);
          toast.success(
            r.wasLinked && !r.googleOk
              ? "Tarefa excluída (o Google Agenda não respondeu)"
              : "Tarefa excluída",
          );
        } catch (e) {
          toast.error((e as Error).message);
        }
        qc.invalidateQueries({ queryKey: ["tasks"] });
      })();
      return;
    }
    const m = item.meeting as (Meeting & { google_event_id?: string | null; google_account?: string | null }) | undefined;
    if (!m) return;
    qc.setQueryData<Meeting[]>(["meetings"], (old) => (old ?? []).filter((x) => x.id !== m.id));
    void (async () => {
      const { error } = await supabase.from("meetings").update({ hidden: true } as never).eq("id", m.id);
      if (error) {
        toast.error(error.message);
        qc.invalidateQueries({ queryKey: ["meetings"] });
        return;
      }
      if (m.google_event_id && m.google_account) {
        try {
          const { deleteGoogleEvent } = await import("@/lib/gcal.functions");
          await deleteGoogleEvent({
            data: { googleAccount: m.google_account, googleEventId: m.google_event_id },
          });
        } catch {
          /* já está oculto na LUCK */
        }
      }
      toast.success("Reunião excluída");
      qc.invalidateQueries({ queryKey: ["meetings"] });
    })();
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
    const quick = quickId === item.id;
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
                height: "auto",
                overflow: "visible",
                left: 2,
                right: 2,
                zIndex: expanded ? 20 : 10,
              }
            : undefined
        }
        className={`group relative cursor-grab overflow-visible rounded-md border px-2 py-1 text-left shadow-sm transition hover:z-20 active:cursor-grabbing ${item.tint} ${
          item.done ? "opacity-60" : ""
        }`}
      >
        {/* Bola lateral vermelha apenas para reuniões reais */}
        {item.meetingColor && (
          <span className="absolute -left-1.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background bg-reuniao shadow-sm" />
        )}
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
            className="min-w-0 flex-1 overflow-visible text-left"
          >
            <div
              className={`h-auto w-full whitespace-pre-wrap break-words text-xs font-medium leading-snug [overflow-wrap:anywhere] ${
                item.done ? "line-through" : ""
              }`}
            >
              {item.title}
            </div>
            {item.statusLabel && !item.done && (
              <span className="mt-0.5 inline-block rounded-full border border-foreground/25 px-1.5 text-[9px] font-medium leading-4 opacity-80">
                {item.statusLabel}
              </span>
            )}
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
          <div className="flex shrink-0 flex-col items-center gap-1">
            <span className={`mt-1 h-2 w-2 rounded-full ${item.dot}`} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setQuickId(quick ? null : item.id);
              }}
              aria-label="Editar rápido"
              className="grid h-4 w-4 place-items-center rounded-[4px] border border-foreground/25 bg-background/70 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {quick && (
          <QuickEdit
            item={item}
            dateKey={itemDateKey(item)}
            onSave={(v) => saveQuick(item, v)}
            onDelete={() => deleteQuick(item)}
            onMore={() => {
              setQuickId(null);
              openItem(item);
            }}
            onClose={() => setQuickId(null)}
          />
        )}

        {expanded && !quick && (
          <div className="mt-1.5 border-t border-foreground/10 pt-1.5">
            {item.notes ? (
              <p className="whitespace-pre-wrap text-[11px] leading-relaxed opacity-80">{item.notes}</p>
            ) : (
              <p className="text-[11px] opacity-60">Sem notas.</p>
            )}
            <button
              onClick={() => setQuickId(item.id)}
              className="mt-1.5 rounded border border-foreground/20 bg-background/60 px-2 py-1 text-[11px] font-medium"
            >
              Editar aqui
            </button>
          </div>
        )}


        {absolute && (item.meeting || item.task) && !expanded && (
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
                if (next !== startDur) {
                  if (item.meeting) resizeMeeting(item.meeting as any, next);
                  else if (item.task) resizeTask(item.task, next);
                }
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

  /** Itens visíveis de um dia: respeita "Sem horário" recolhido e "Concluídos" escondidos. */
  const visibleFor = (key: string) =>
    itemsFor(key).filter((i) => i.startMin !== null || (stripOpen && (doneOpen || !i.done)));

  // Barra Sem horário / Concluídos (igual em Dia, 2 dias e 5 dias)
  const untimedBar = (() => {
    const untimed = rangeDays.flatMap((d) => itemsFor(fmtKey(d)).filter((i) => i.startMin === null));
    const pendingCount = untimed.filter((i) => !i.done).length;
    const doneCount = untimed.length - pendingCount;
    return (
      <div className="flex flex-wrap items-center gap-2 border-b bg-secondary/40 px-2 py-1.5 text-[11px] font-medium">
        <button
          onClick={() => {
            const next = !stripOpen;
            setStripOpen(next);
            try {
              window.localStorage.setItem("luck.cal.strip", next ? "1" : "0");
            } catch {
              /* ignora */
            }
          }}
          className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-foreground shadow-sm hover:bg-accent"
          aria-expanded={stripOpen}
          title={stripOpen ? "Clique para recolher" : "Clique para abrir"}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${stripOpen ? "" : "-rotate-90"}`} />
          Sem horário · {pendingCount}
          <span className="font-normal text-muted-foreground">{stripOpen ? "recolher" : "abrir"}</span>
        </button>
        {doneCount > 0 && stripOpen && (
          <button
            onClick={() => {
              const next = !doneOpen;
              setDoneOpen(next);
              try {
                window.localStorage.setItem("luck.cal.done", next ? "1" : "0");
              } catch {
                /* ignora */
              }
            }}
            className="ml-auto flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-foreground shadow-sm hover:bg-accent"
            aria-expanded={doneOpen}
            title={doneOpen ? "Clique para esconder os concluídos" : "Clique para ver os concluídos"}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${doneOpen ? "" : "-rotate-90"}`} />
            Concluídos · {doneCount}
            <span className="font-normal text-muted-foreground">{doneOpen ? "esconder" : "ver"}</span>
          </button>
        )}
      </div>
    );
  })();

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

      {isMobile && (view === "2day" || view === "5day") ? (
        /* Celular: lista por dia — evita colunas estreitas e texto empilhado. */
        <div className="space-y-3">
          {untimedBar}
          {undatedTasks.length > 0 && (
            <div className="rounded-xl border bg-secondary/40 p-2">
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                sem data
              </p>
              <div className="space-y-1.5">
                {undatedTasks.map((t) => (
                  <ItemBlock key={t.id} item={taskItem(t)} compact />
                ))}
              </div>
            </div>
          )}
          {rangeDays.map((d) => {
            const key = fmtKey(d);
            const items = visibleFor(key);
            const isToday = key === todayKey;
            return (
              <div key={key} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                      isToday ? "bg-primary text-primary-foreground" : "bg-secondary"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm capitalize">
                    {d.toLocaleDateString("pt-BR", { weekday: "long", month: "short" })}
                  </span>
                  <button
                    onClick={() => setChooser({ date: key, time: null })}
                    className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    <Plus className="h-3 w-3" /> Novo
                  </button>
                </div>
                <div className="space-y-1.5 p-2">
                  {items.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">Nada marcado.</p>
                  ) : (
                    items.map((i) => <ItemBlock key={i.id} item={i} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === "month" ? (
        <div className="rounded-xl border bg-card">
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
              const all = itemsFor(key);
              const pending = all.filter((i) => !i.done);
              const doneN = all.length - pending.length;
              const muted = d.getMonth() !== cursor.getMonth();
              const goDay = () => {
                setCursor(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
                setView("day");
              };
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={goDay}
                  onKeyDown={(e) => e.key === "Enter" && goDay()}
                  onDragOver={(e) => onDragOver(e, key)}
                  onDragLeave={() => dragOverKey === key && setDragOverKey(null)}
                  onDrop={(e) => onDropDay(e, key)}
                  title="Clique para abrir o dia"
                  className={`h-[76px] cursor-pointer overflow-hidden border-b border-r p-1 last:border-r-0 hover:bg-accent/40 sm:h-[104px] sm:p-1.5 ${muted ? "bg-secondary/30" : ""} ${dragOverKey === key ? "bg-accent" : ""}`}
                >
                  <div className="flex items-center justify-between gap-1">
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
                    {pending.length > 0 && (
                      <span className="rounded-full bg-secondary px-1.5 text-[10px] font-medium leading-4 text-foreground sm:hidden">
                        {pending.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                    {pending.slice(0, 6).map((i) => (
                      <span key={i.id} className={`h-1.5 w-1.5 rounded-full ${i.dot}`} />
                    ))}
                  </div>
                  <div className="mt-1 hidden space-y-0.5 sm:block">
                    {pending.slice(0, 3).map((i) => (
                      <div
                        key={i.id}
                        className={`flex items-center gap-1 truncate rounded px-1 text-[10px] leading-4 ${i.tint}`}
                        title={i.title}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${i.dot}`} />
                        <span className="truncate">{i.title}</span>
                      </div>
                    ))}
                    {(pending.length > 3 || doneN > 0) && (
                      <div className="text-[10px] text-muted-foreground">
                        {pending.length > 3 ? `+${pending.length - 3} ` : ""}
                        {doneN > 0 ? `· ${doneN} concluído${doneN > 1 ? "s" : ""}` : ""}
                      </div>
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

      {view === "5day" ? (
        <>
        {untimedBar}
        <div className="max-h-[70vh] overflow-y-auto">
          <div className="grid" style={{ gridTemplateColumns: `48px repeat(5, minmax(0, 1fr))` }}>
            <div />
            {rangeDays.map((d) => {
              const key = fmtKey(d);
              const items = visibleFor(key);
              return (
                <div
                  key={key}
                  onDragOver={(e) => onDragOver(e, key)}
                  onDragLeave={() => dragOverKey === key && setDragOverKey(null)}
                  onDrop={(e) => onDropDay(e, key)}
                  onDoubleClick={() => setChooser({ date: key, time: null })}
                  className={`min-h-40 border-r last:border-r-0 p-1.5 ${dragOverKey === key ? "bg-accent/40" : ""}`}
                >
                  {items.length === 0 && (
                    <button
                      onClick={() => setChooser({ date: key, time: null })}
                      className="flex w-full items-center justify-center gap-1 rounded border border-dashed py-1 text-[10px] text-muted-foreground hover:bg-accent"
                    >
                      <Plus className="h-3 w-3" /> Novo
                    </button>
                  )}
                  <div className="space-y-1">
                    {items.map((i) => (
                      <ItemBlock key={i.id} item={i} compact />
                    ))}
                  </div>
                  {items.length > 0 && (
                    <button
                      onClick={() => setChooser({ date: key, time: null })}
                      className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-dashed py-1 text-[10px] text-muted-foreground hover:bg-accent"
                    >
                      <Plus className="h-3 w-3" /> Novo
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </>
      ) : (
        <>
          {untimedBar}
          {stripOpen && (
          <div className="max-h-[28vh] overflow-y-auto border-b bg-secondary/20">
          <div
            className="grid"
            style={{ gridTemplateColumns: `48px repeat(${rangeDays.length}, minmax(0, 1fr))` }}
          >
            <div className="py-1 pr-1 text-right text-[10px] text-muted-foreground">dia</div>
            {rangeDays.map((d) => {
              const key = fmtKey(d);
              const allDay = itemsFor(key).filter((i) => i.startMin === null && (doneOpen || !i.done));
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
                    onClick={() => setChooser({ date: key, time: null })}
                    className="flex w-full items-center justify-center gap-1 rounded border border-dashed py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                  >
                    <Plus className="h-3 w-3" /> Novo
                  </button>
                </div>
              );
            })}
          </div>
          </div>
          )}

          {/* Grade de horas */}
          <div ref={gridRef} className="max-h-[55vh] overflow-y-auto">
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
                    onDoubleClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const raw = Math.round((((e.clientY - rect.top) / HOUR_H) * 60) / 15) * 15;
                      const mins = Math.max(0, Math.min(23 * 60 + 45, raw));
                      setChooser({ date: key, time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` });
                    }}
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
        </>
      )}
        </div>
      )}

      {editing && <MeetingEditModal meeting={editing} onClose={() => setEditing(null)} />}
      {editingTask && <TaskEditModal task={editingTask} onClose={() => setEditingTask(null)} />}
      {newMeetingDay && (
        <NewMeetingModal
          defaultDate={newMeetingDay}
          defaultTime={newMeetingTime}
          onClose={() => setNewMeetingDay(null)}
        />
      )}
      {newTaskAt && (
        <NewTaskModal
          defaultDate={newTaskAt.date}
          defaultTime={newTaskAt.time}
          onClose={() => setNewTaskAt(null)}
        />
      )}
      {chooser && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-4 md:items-center"
          onClick={() => setChooser(null)}
        >
          <div
            className="w-full max-w-xs rounded-xl border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-medium">O que você quer criar?</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {chooser.date.split("-").reverse().join("/")}
              {chooser.time ? ` · ${chooser.time}` : ""}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setNewTaskAt(chooser);
                  setChooser(null);
                }}
                className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Tarefa
              </button>
              <button
                onClick={() => {
                  setNewMeetingTime(chooser.time);
                  setNewMeetingDay(chooser.date);
                  setChooser(null);
                }}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                Reunião
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
