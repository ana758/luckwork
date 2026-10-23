import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, ExternalLink, KeyRound, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isAllDay, localDateKey, meetingDateKey, meetingTimeLabel } from "@/lib/all-day";
import { AccessDrawer } from "@/components/AccessDrawer";
import { endOfWeek, startOfWeek, useAccessEntries, useMeetings, useTasks } from "@/lib/queries";
import { isOverdue, SOURCE_CHIP, SOURCE_DOT, type Meeting, type SourceKey, type Task } from "@/lib/sources";
import { useArchivedSources } from "@/lib/archived-sources";

// Partes pesadas carregam depois do resto da tela.
const AiConsole = lazy(() => import("@/components/AiConsole").then((m) => ({ default: m.AiConsole })));
const AiMemoryCard = lazy(() => import("@/components/AiMemoryCard").then((m) => ({ default: m.AiMemoryCard })));

const SOURCE_BAR: Record<SourceKey, string> = {
  angi: "var(--angi)",
  devore: "var(--devore)",
  bruna: "var(--bruna)",
  pessoal: "var(--pessoal)",
};

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Início · LUCK" },
      { name: "description", content: "Próxima reunião, tarefas de hoje, semana por empresa e próximos dias." },
      { property: "og:title", content: "Início · LUCK" },
      { property: "og:description", content: "Seu dia organizado por empresa no LUCK." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function taskDay(t: Task) {
  return t.due_date ?? t.start_date ?? null;
}

function meetingLink(m: Meeting) {
  const cand = [m.external_url, m.location].find((v) => v && /^https?:\/\//.test(v));
  return cand ?? null;
}

function greeting(h: number) {
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function Dashboard() {
  const qc = useQueryClient();
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const { data: access = [] } = useAccessEntries();
  const { visibleSources } = useArchivedSources();
  const [drawer, setDrawer] = useState<SourceKey | null>(null);
  const [showAllToday, setShowAllToday] = useState(false);
  const [name, setName] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      const full = (u?.user_metadata?.full_name as string | undefined) ?? u?.email ?? "";
      setName(full.split(/[\s@]/)[0] ?? "");
    });
    return () => clearInterval(id);
  }, []);

  const today = localDateKey(now);
  const keys = useMemo(() => visibleSources.map((s) => s.key), [visibleSources]);

  // Próxima reunião (ou a que está acontecendo agora).
  const nextMeeting = useMemo(() => {
    const t = now.getTime();
    return meetings
      .filter((m) => m.is_meeting === true && !isAllDay(m) && m.status !== "done")
      .filter((m) => {
        const end = m.ends_at ? new Date(m.ends_at).getTime() : new Date(m.starts_at).getTime() + 3600_000;
        return end > t;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  }, [meetings, now]);

  // Hoje: reuniões + tarefas, pendentes por horário, concluídas no fim.
  const todayList = useMemo(() => {
    const m = meetings
      .filter((x) => meetingDateKey(x) === today)
      .map((x) => ({
        id: `m-${x.id}`,
        title: x.title,
        dot: x.is_meeting ? "bg-reuniao" : SOURCE_DOT[x.source],
        time: isAllDay(x) ? "" : (meetingTimeLabel(x) ?? ""),
        tag: x.is_meeting ? "Reunião" : x.source,
        done: x.status === "done",
        task: null as Task | null,
      }));
    const t = tasks
      .filter((x) => taskDay(x) === today && keys.includes(x.source))
      .map((x) => ({
        id: `t-${x.id}`,
        title: x.title,
        dot: SOURCE_DOT[x.source],
        time: (x as Task & { due_time?: string | null }).due_time?.slice(0, 5) ?? "",
        tag: x.source,
        done: x.status === "done",
        task: x,
      }));
    return [...m, ...t].sort(
      (a, b) => Number(a.done) - Number(b.done) || (a.time || "99").localeCompare(b.time || "99"),
    );
  }, [tasks, meetings, today, keys]);
  const doneToday = todayList.filter((x) => x.done).length;

  const weekTasks = useMemo(
    () =>
      tasks.filter((t) => {
        const ref = taskDay(t);
        if (!ref || !keys.includes(t.source)) return false;
        const d = new Date(`${ref}T12:00:00`);
        return d >= startOfWeek() && d <= endOfWeek();
      }),
    [tasks, keys],
  );

  const overdue = useMemo(() => tasks.filter((t) => keys.includes(t.source) && isOverdue(t)), [tasks, keys]);

  // Próximos 4 dias (sem hoje): reuniões e tarefas com data.
  const upcoming = useMemo(() => {
    const days = [1, 2, 3, 4].map((n) => localDateKey(addDays(now, n)));
    const set = new Set(days);
    const items = [
      ...meetings
        .filter((m) => set.has(meetingDateKey(m)))
        .map((m) => ({
          id: `m-${m.id}`,
          day: meetingDateKey(m),
          title: m.title,
          sub: isAllDay(m) ? "dia todo" : (meetingTimeLabel(m) ?? ""),
          bar: m.is_meeting ? "var(--reuniao)" : SOURCE_BAR[m.source],
        })),
      ...tasks
        .filter((t) => t.status !== "done" && keys.includes(t.source) && set.has(taskDay(t) ?? ""))
        .map((t) => ({
          id: `t-${t.id}`,
          day: taskDay(t)!,
          title: t.title,
          sub: (t as Task & { due_time?: string | null }).due_time?.slice(0, 5) ?? "dia todo",
          bar: SOURCE_BAR[t.source],
        })),
    ].sort((a, b) => a.day.localeCompare(b.day) || a.sub.localeCompare(b.sub));
    return { days, items };
  }, [meetings, tasks, keys, now]);

  async function toggleTask(t: Task) {
    const wasDone = t.status === "done";
    const status = wasDone ? "todo" : "done";
    const completed_at = wasDone ? null : new Date().toISOString();
    qc.setQueryData<Task[]>(["tasks"], (old) =>
      (old ?? []).map((x) => (x.id === t.id ? ({ ...x, status, completed_at } as Task) : x)),
    );
    const { error } = await supabase.from("tasks").update({ status, completed_at }).eq("id", t.id);
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    }
  }

  const minsTo = nextMeeting ? Math.round((new Date(nextMeeting.starts_at).getTime() - now.getTime()) / 60000) : 0;
  const visibleToday = showAllToday ? todayList : todayList.slice(0, 6);
  const dayLabel = (k: string) => {
    const d = new Date(`${k}T12:00:00`);
    return {
      wd: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      n: d.getDate(),
    };
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs text-muted-foreground first-letter:uppercase">
          {now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(now.getHours())}
          {name ? `, ${name.charAt(0).toUpperCase()}${name.slice(1)}` : ""}
        </h1>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        {/* Coluna 1: próxima reunião + hoje */}
        <div className="min-w-0 space-y-4">
          {nextMeeting ? (
            <section className="rounded-2xl border border-reuniao/30 bg-reuniao/10 p-4">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-reuniao">
                <span>
                  {minsTo <= 0 ? "Acontecendo agora" : minsTo < 60 ? `Próxima · em ${minsTo} min` : "Próxima reunião"}
                </span>
                <span className="tabular-nums text-foreground">{meetingTimeLabel(nextMeeting)}</span>
              </div>
              <p className="mt-1.5 break-words text-base font-semibold leading-snug">{nextMeeting.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 ${SOURCE_CHIP[nextMeeting.source]}`}>
                  {visibleSources.find((s) => s.key === nextMeeting.source)?.label ?? nextMeeting.source}
                </span>
                {meetingDateKey(nextMeeting) !== today && (
                  <span className="text-muted-foreground">
                    {new Date(nextMeeting.starts_at).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" })}
                  </span>
                )}
                {meetingLink(nextMeeting) && (
                  <a
                    href={meetingLink(nextMeeting)!}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-reuniao px-2 py-1 font-medium text-primary-foreground"
                  >
                    <Video className="h-3.5 w-3.5" /> Entrar
                  </a>
                )}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
              Nenhuma reunião pela frente.
            </section>
          )}

          <section className="rounded-2xl border bg-card">
            <div className="flex items-center justify-between px-4 pt-3">
              <h2 className="text-sm font-semibold">Hoje</h2>
              <span className="text-xs text-muted-foreground">
                {doneToday} de {todayList.length} feitas
              </span>
            </div>
            {todayList.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">Nada marcado para hoje.</p>
            ) : (
              <ul className="mt-2 divide-y">
                {visibleToday.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                    {it.task ? (
                      <button
                        onClick={() => toggleTask(it.task!)}
                        aria-label="Concluir"
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${
                          it.done ? "border-success bg-success text-success-foreground" : "border-foreground/30"
                        }`}
                      >
                        {it.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{it.time || "—"}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${it.dot}`} />
                    <span
                      className={`min-w-0 flex-1 break-words text-sm ${it.done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {it.title}
                    </span>
                    <span className="hidden shrink-0 text-[11px] capitalize text-muted-foreground sm:inline">
                      {it.tag === "Reunião" ? it.tag : visibleSources.find((s) => s.key === it.tag)?.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {todayList.length > 6 && (
              <button
                onClick={() => setShowAllToday((v) => !v)}
                className="w-full border-t px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                {showAllToday ? "Ver menos" : `Ver mais (${todayList.length - 6})`}
              </button>
            )}
          </section>
        </div>

        {/* Coluna 2: semana por empresa */}
        <div className="min-w-0 space-y-3">
          <h2 className="text-sm font-semibold">Semana por empresa</h2>
          {visibleSources.map((s) => {
            const list = weekTasks.filter((t) => t.source === s.key);
            const done = list.filter((t) => t.status === "done").length;
            const pct = list.length ? Math.round((done / list.length) * 100) : 0;
            const late = overdue.filter((t) => t.source === s.key).length;
            const links = access.filter((a) => a.source === s.key && a.url).slice(0, 3);
            return (
              <div key={s.key} className="rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${SOURCE_DOT[s.key]}`} />
                  <p className="text-sm font-medium">{s.label}</p>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {done} de {list.length}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: SOURCE_BAR[s.key] }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {links.map((l) => (
                    <a
                      key={l.id}
                      href={l.url!}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> {l.label}
                    </a>
                  ))}
                  <button
                    onClick={() => setDrawer(s.key)}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <KeyRound className="h-3 w-3" /> Acessos
                  </button>
                  {late > 0 && (
                    <Link to="/tarefas" className="ml-auto font-medium text-destructive">
                      {late} atrasada{late > 1 ? "s" : ""}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Coluna 3: próximos dias + atrasadas */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Próximos dias</h2>
              <Link to="/calendario" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
                Calendário <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid grid-cols-5 gap-1 text-center">
              {[today, ...upcoming.days].map((k, i) => {
                const { wd, n } = dayLabel(k);
                return (
                  <div key={k} className={`rounded-lg py-1 ${i === 0 ? "bg-foreground text-background" : ""}`}>
                    <p className="text-[10px] uppercase opacity-70">{wd}</p>
                    <p className="text-sm font-semibold">{n}</p>
                  </div>
                );
              })}
            </div>
            {upcoming.items.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">Nada marcado nos próximos dias.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {upcoming.items.slice(0, 6).map((it) => (
                  <li key={it.id} className="border-l-2 pl-2" style={{ borderColor: it.bar }}>
                    <p className="break-words text-sm font-medium leading-snug">{it.title}</p>
                    <p className="text-[11px] capitalize text-muted-foreground">
                      {dayLabel(it.day).wd} {dayLabel(it.day).n} · {it.sub}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {overdue.length > 0 && (
            <section className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" /> {overdue.length} atrasada{overdue.length > 1 ? "s" : ""}
              </p>
              <ul className="mt-2 space-y-1">
                {overdue.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_DOT[t.source]}`} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <button onClick={() => toggleTask(t)} className="shrink-0 font-medium text-destructive hover:underline">
                      Feito
                    </button>
                  </li>
                ))}
              </ul>
              <Link
                to="/tarefas"
                className="mt-3 inline-flex rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground"
              >
                Revisar agora
              </Link>
            </section>
          )}
        </div>
      </div>

      {/* IA: e-mails importantes, chat e memória — carregam depois */}
      <Suspense
        fallback={
          <div className="flex items-center gap-2 rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" /> Carregando LUCK AI…
          </div>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <AiConsole compact />
          </div>
          <div className="min-w-0">
            <AiMemoryCard />
          </div>
        </div>
      </Suspense>

      {drawer && <AccessDrawer source={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
