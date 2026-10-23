import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Pencil, Plus, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { SyncGoogleButton } from "@/components/SyncGoogleButton";
import { MeetingEditModal } from "@/components/MeetingEditModal";
import { NewMeetingModal } from "@/components/NewMeetingModal";
import { useMeetings } from "@/lib/queries";
import { withAuthRetry } from "@/lib/auth-retry";
import { aiAction } from "@/lib/ai.functions";
import { isAllDay, meetingDateKey } from "@/lib/all-day";
import { supabase } from "@/integrations/supabase/client";
import { deleteGoogleEvent } from "@/lib/gcal.functions";
import { SOURCE_CHIP, SOURCE_LABEL, type Meeting } from "@/lib/sources";

export const Route = createFileRoute("/_authenticated/reunioes")({
  head: () => ({
    meta: [
      { title: "Reuniões · LUCK" },
      { name: "description", content: "Reuniões com participantes, pauta e notas." },
      { property: "og:title", content: "Reuniões · LUCK" },
      { property: "og:description", content: "Reuniões com participantes e anotações." },
    ],
  }),
  component: MeetingsPage,
});

const button =
  "inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function time(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function section(notes: string | null, heading: string) {
  const lines = (notes ?? "").split("\n");
  const index = lines.findIndex((line) =>
    new RegExp(`^\\s*#{0,3}\\s*${heading}\\s*:?\\s*$`, "i").test(line),
  );
  if (index < 0) return "";
  const result: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (/^\s*(?:#{1,3}\s+|(?:Pauta|Participantes|Próximos passos|Notas da reunião)\s*:)/i.test(line)) break;
    result.push(line);
  }
  return result.join("\n").trim();
}

function meetingLink(meeting: Meeting) {
  const candidates = [meeting.external_url, ...(meeting.notes?.match(/https?:\/\/[^\s<>"']+/gi) ?? [])];
  return candidates
    .map((value) => value?.replace(/[),.;]+$/, ""))
    .find((value): value is string => !!value && /^https?:\/\//i.test(value));
}

function countdown(meeting: Meeting, now: number) {
  if (isAllDay(meeting)) return "Dia inteiro";
  const start = new Date(meeting.starts_at).getTime();
  const end = meeting.ends_at ? new Date(meeting.ends_at).getTime() : start + 3_600_000;
  if (now >= end) return "Encerrada";
  if (now >= start) return "Em andamento";
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes < 60) return `em ${minutes} min`;
  if (minutes < 1_440) return `em ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `em ${Math.ceil(minutes / 1_440)} dias`;
}

function dayLabel(key: string, now: number) {
  const date = new Date(`${key}T12:00:00`);
  if (date.toDateString() === new Date(now).toDateString()) return "Hoje";
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long" }).replace("-feira", "");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${date.getDate()}`;
}

function signature(meeting: Pick<Meeting, "title" | "starts_at">) {
  return `${meeting.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}::${new Date(meeting.starts_at).toISOString()}`;
}

function MeetingsPage() {
  const { data: allMeetings = [], isLoading, isError } = useMeetings();
  const qc = useQueryClient();
  const delGoogle = useServerFn(deleteGoogleEvent);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const monthStart = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }, []);

  const meetings = useMemo(
    () =>
      allMeetings.filter(
        (meeting) =>
          meeting.is_meeting !== false &&
          new Date(meeting.starts_at).getTime() >= monthStart &&
          !pending.has(meeting.id),
      ),
    [allMeetings, monthStart, pending],
  );

  const upcoming = meetings.filter((m) => {
    const end = m.ends_at ? new Date(m.ends_at).getTime() : new Date(m.starts_at).getTime() + 3_600_000;
    return end >= now;
  });
  const upcomingIds = new Set(upcoming.map((m) => m.id));
  const past = meetings.filter((m) => !upcomingIds.has(m.id)).reverse();
  const items = tab === "upcoming" ? upcoming : past;
  const selected = meetings.find((m) => m.id === selectedId) ?? items[0] ?? null;

  const groups = new Map<string, Meeting[]>();
  for (const meeting of items) {
    const key = meetingDateKey(meeting);
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    const meeting = allMeetings.find((item) => item.id === id);
    if (!meeting) return;
    setSelectedId(meeting.id);
    setTab(new Date(meeting.starts_at).getTime() >= Date.now() ? "upcoming" : "past");
    setMobileDetail(true);
  }, [allMeetings]);

  function deleteMeeting(meeting: Meeting) {
    if (pendingRef.current.has(meeting.id)) return;
    const sig = signature(meeting);
    const affected = allMeetings.filter((item) => signature(item) === sig);
    const ids = affected.map((item) => item.id);
    for (const id of ids) pendingRef.current.add(id);
    setPending(new Set(pendingRef.current));
    setEditing(null);
    setMobileDetail(false);

    let undone = false;
    const timer = window.setTimeout(() => {
      if (undone) return;
      void (async () => {
        try {
          const { error } = await supabase
            .from("meetings")
            .update({ hidden: true } as never)
            .eq("title", meeting.title)
            .eq("starts_at", meeting.starts_at);
          if (error) throw new Error(error.message);
          qc.setQueryData<Meeting[]>(["meetings"], (old) => (old ?? []).filter((item) => !ids.includes(item.id)));
          const results = await Promise.allSettled(
            affected.flatMap((item) =>
              item.google_event_id && item.google_account
                ? [delGoogle({ data: { googleAccount: item.google_account, googleEventId: item.google_event_id } })]
                : [],
            ),
          );
          const failures = results.filter((r) => r.status === "rejected").length;
          if (failures) toast.warning(`${failures} não removidas no Google Agenda (removidas do LUCK)`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Não foi possível remover.");
        } finally {
          for (const id of ids) pendingRef.current.delete(id);
          setPending(new Set(pendingRef.current));
          void qc.invalidateQueries({ queryKey: ["meetings"] });
          void qc.invalidateQueries({ queryKey: ["tasks"] });
        }
      })();
    }, 5_000);

    toast("Reunião removida", {
      duration: 5_000,
      action: {
        label: "Desfazer",
        onClick: () => {
          undone = true;
          window.clearTimeout(timer);
          for (const id of ids) pendingRef.current.delete(id);
          setPending(new Set(pendingRef.current));
          setSelectedId(meeting.id);
        },
      },
    });
  }

  return (
    <div className="grid min-h-[75vh] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={`${mobileDetail ? "hidden md:block" : ""} border-border md:border-r md:bg-secondary/30`}>
        <header className="space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Reuniões</h1>
            <button
              onClick={() => setCreating(true)}
              className={`${button} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`}
            >
              <Plus className="h-4 w-4" /> Nova
            </button>
          </div>
          <SyncGoogleButton />
          <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
            {(["upcoming", "past"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={tab === value}
                onClick={() => {
                  setTab(value);
                  setSelectedId(null);
                }}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  tab === value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value === "upcoming" ? "Próximas" : "Anteriores"}
              </button>
            ))}
          </div>
        </header>

        <nav aria-label="Lista de reuniões" className="space-y-5 p-3 md:max-h-[calc(100dvh-220px)] md:overflow-y-auto">
          {isLoading && <p className="p-2 text-sm text-muted-foreground">Carregando…</p>}
          {isError && <p className="p-2 text-sm text-destructive">Não foi possível carregar as reuniões.</p>}
          {!isLoading && !isError && items.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">Nenhuma reunião por aqui.</p>
          )}
          {Array.from(groups, ([key, dayMeetings]) => (
            <section key={key}>
              <h2 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {dayLabel(key, now)}
              </h2>
              <div className="space-y-1.5">
                {dayMeetings.map((meeting) => {
                  const soon =
                    new Date(meeting.starts_at).getTime() > now &&
                    new Date(meeting.starts_at).getTime() - now < 3 * 3_600_000;
                  return (
                    <button
                      key={meeting.id}
                      aria-current={selected?.id === meeting.id ? "true" : undefined}
                      onClick={() => {
                        setSelectedId(meeting.id);
                        setMobileDetail(true);
                      }}
                      className={`flex w-full gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selected?.id === meeting.id ? "border-primary bg-card shadow-sm" : "border-transparent hover:bg-accent"
                      }`}
                    >
                      <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums">
                        {isAllDay(meeting) ? "Dia" : time(meeting.starts_at)}
                      </span>
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block text-sm font-medium">{meeting.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {SOURCE_LABEL[meeting.source]} · {meetingLink(meeting) ? "Meet" : meeting.meeting_type || "Reunião"}
                          {soon && <span className="font-medium text-reuniao"> · {countdown(meeting, now)}</span>}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </aside>

      <main className={`${mobileDetail ? "" : "hidden md:block"} min-w-0 p-5 md:p-8`}>
        <button onClick={() => setMobileDetail(false)} className={`${button} mb-5 md:hidden`}>
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
        {selected ? (
          <MeetingDetail
            key={selected.id}
            meeting={selected}
            now={now}
            onEdit={() => setEditing(selected)}
            onDelete={() => deleteMeeting(selected)}
          />
        ) : (
          <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
            Selecione uma reunião para ver os detalhes.
          </div>
        )}
      </main>

      {editing && (
        <MeetingEditModal meeting={editing} onClose={() => setEditing(null)} onDelete={() => deleteMeeting(editing)} />
      )}
      {creating && <NewMeetingModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function MeetingDetail({
  meeting,
  now,
  onEdit,
  onDelete,
}: {
  meeting: Meeting;
  now: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const runAi = useServerFn(aiAction);
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [saveState, setSaveState] = useState("Salvo");
  const [generating, setGenerating] = useState(false);
  const saved = useRef(meeting.notes ?? "");
  const latest = useRef(notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const link = meetingLink({ ...meeting, notes });

  function persist(value: string) {
    const request = chain.current.then(async () => {
      if (value === saved.current) return;
      if (mounted.current) setSaveState("Salvando…");
      await withAuthRetry(() => supabase.from("meetings").update({ notes: value || null }).eq("id", meeting.id));
      saved.current = value;
      qc.setQueryData<Meeting[]>(["meetings"], (old) =>
        old?.map((item) => (item.id === meeting.id ? { ...item, notes: value || null } : item)),
      );
      if (mounted.current && latest.current === value) setSaveState("Salvo");
    });
    chain.current = request.catch((error) => {
      if (mounted.current) setSaveState("Erro ao salvar");
      toast.error(error instanceof Error ? error.message : "Erro ao salvar notas.");
    });
    return request;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      void persist(latest.current).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const incoming = meeting.notes ?? "";
    if (latest.current === saved.current && incoming !== saved.current) {
      saved.current = incoming;
      latest.current = incoming;
      setNotes(incoming);
    }
  }, [meeting.notes]);

  function changeNotes(value: string) {
    latest.current = value;
    setNotes(value);
    setSaveState("Alterações pendentes");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(value).catch(() => {});
    }, 800);
  }

  async function generateTasks() {
    if (!notes.trim() || generating) return;
    setGenerating(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      await persist(latest.current);
      const result = await runAi({
        data: {
          text: [
            `Crie tarefa(s) com os próximos passos explícitos nas notas desta reunião.`,
            `Empresa obrigatória: ${SOURCE_LABEL[meeting.source]} (source: ${meeting.source}).`,
            `Reunião: ${meeting.title}.`,
            `Não altere nem remova tarefas ou reuniões existentes.`,
            `Não invente compromissos, responsáveis ou prazos ausentes das notas.`,
            `Notas:\n${latest.current}`,
          ].join("\n"),
        },
      });
      toast(result.reply);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["meetings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar tarefas.");
    } finally {
      if (mounted.current) setGenerating(false);
    }
  }

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${SOURCE_CHIP[meeting.source]}`}>
            {SOURCE_LABEL[meeting.source]}
          </span>
          <div className="flex gap-2">
            <button onClick={onEdit} className={button}>
              <Pencil className="h-4 w-4" /> Editar
            </button>
            <button onClick={onDelete} className={`${button} text-destructive`} aria-label={`Apagar ${meeting.title}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{meeting.title}</h2>
        <p className="text-sm text-muted-foreground">
          {new Date(`${meetingDateKey(meeting)}T12:00:00`).toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {" · "}
          {isAllDay(meeting)
            ? "Dia inteiro"
            : `${time(meeting.starts_at)}${meeting.ends_at ? ` – ${time(meeting.ends_at)}` : ""}`}
          {" · "}
          {meeting.location || (link ? "Google Meet" : "Local não informado")}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-success px-5 py-2.5 font-medium text-success-foreground hover:opacity-90"
            >
              <Video className="h-5 w-5" /> Entrar no Meet
            </a>
          )}
          <span className="text-sm font-medium text-reuniao">{countdown(meeting, now)}</span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border p-4">
          <h3 className="mb-2 text-sm font-medium">Pauta</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {section(notes, "Pauta") || "Nenhuma pauta informada."}
          </p>
        </section>
        <section className="rounded-xl border border-border p-4">
          <h3 className="mb-2 text-sm font-medium">Participantes</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {meeting.people || section(notes, "Participantes") || "Nenhum participante informado."}
          </p>
        </section>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="meeting-notes" className="text-sm font-medium">
            Notas da reunião
          </label>
          <span role="status" className="text-xs text-muted-foreground">
            {saveState}
          </span>
        </div>
        <textarea
          id="meeting-notes"
          value={notes}
          onChange={(e) => changeNotes(e.target.value)}
          placeholder="Escreva durante a reunião…"
          rows={8}
          className="w-full resize-y rounded-xl border border-border bg-background p-4 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
        />
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bruna/30 bg-bruna-soft p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Próximos passos</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada passo vira uma tarefa de {SOURCE_LABEL[meeting.source]}.
          </p>
        </div>
        <button
          onClick={() => void generateTasks()}
          disabled={generating || !notes.trim()}
          className={`${button} border-transparent bg-primary text-primary-foreground`}
        >
          {generating ? "Gerando…" : "Gerar com a IA a partir das notas"}
        </button>
      </section>
    </article>
  );
}
