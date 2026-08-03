import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AlertTriangle, ExternalLink, KeyRound } from "lucide-react";
import { AccessDrawer } from "@/components/AccessDrawer";
import { endOfWeek, startOfWeek, useAccessEntries, useMeetings, useTasks } from "@/lib/queries";
import {
  isOverdue,
  SOURCE_CHIP,
  SOURCE_DOT,
  type SourceKey,
  type Task,
} from "@/lib/sources";
import { useArchivedSources } from "@/lib/archived-sources";

const SOURCE_HEX: Record<SourceKey, string> = {
  angi: "var(--angi)",
  devore: "var(--devore)",
  bruna: "var(--bruna)",
  pessoal: "var(--pessoal)",
};

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Início · LUCK" },
      {
        name: "description",
        content: "Painel com pendências por empresa, reuniões do dia e progresso semanal.",
      },
      { property: "og:title", content: "Início · LUCK" },
      { property: "og:description", content: "Pendências por empresa e progresso da semana." },
    ],
  }),
  component: Dashboard,
});

function inWeek(task: Task) {
  const ref = task.due_date ?? task.start_date;
  if (!ref) return false;
  const d = new Date(`${ref}T12:00:00`);
  return d >= startOfWeek() && d <= endOfWeek();
}

function Dashboard() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const { data: access = [] } = useAccessEntries();
  const [drawer, setDrawer] = useState<SourceKey | null>(null);
  const { visibleSources } = useArchivedSources();

  const today = new Date().toISOString().slice(0, 10);

  const todayItems = useMemo(() => {
    const t = tasks.filter((x) => x.due_date === today && x.status !== "done");
    const m = meetings.filter((x) => x.starts_at.slice(0, 10) === today);
    return { t, m };
  }, [tasks, meetings, today]);

  const weekTasks = useMemo(() => {
    const keys = visibleSources.map((s) => s.key);
    return tasks.filter((t) => inWeek(t) && keys.includes(t.source));
  }, [tasks, visibleSources]);

  const bySource = useMemo(() => {
    return visibleSources
      .map((s) => {
        const list = weekTasks.filter((t) => t.source === s.key);
        const done = list.filter((t) => t.status === "done").length;
        return {
          key: s.key,
          name: s.label,
          value: list.length,
          done,
          pending: list.length - done,
          fill: SOURCE_HEX[s.key],
        };
      })
      .filter((x) => x.value > 0);
  }, [weekTasks, visibleSources]);

  const weekStats = useMemo(() => {
    const total = weekTasks.length;
    const done = weekTasks.filter((t) => t.status === "done").length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, pct };
  }, [weekTasks]);

  

  const overdueTasks = useMemo(() => {
    const keys = visibleSources.map((s) => s.key);
    return tasks.filter((t) => isOverdue(t) && keys.includes(t.source));
  }, [tasks, visibleSources]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Início</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          })}
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        {overdueTasks.length > 0 && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <h2 className="text-sm font-semibold">
                {overdueTasks.length} tarefa{overdueTasks.length > 1 ? "s" : ""} atrasada
                {overdueTasks.length > 1 ? "s" : ""}
              </h2>
            </div>
            <ul className="space-y-1.5">
              {(showAllOverdue ? overdueTasks : overdueTasks.slice(0, 3)).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_DOT[t.source]}`} />
                  <Link to="/tarefas" className="truncate hover:underline">
                    {t.title}
                  </Link>
                  <span className="ml-auto shrink-0 text-xs text-destructive/80">
                    {t.due_date &&
                      new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
            {overdueTasks.length > 3 && (
              <button
                onClick={() => setShowAllOverdue((v) => !v)}
                className="mt-3 w-full rounded-md border border-destructive/30 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                {showAllOverdue ? "Ver menos" : `Ver mais (${overdueTasks.length - 3})`}
              </button>
            )}
          </div>
        )}

        {/* Hoje */}
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Hoje</h2>
          {todayList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada marcado para hoje.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {(showAllToday ? todayList : todayList.slice(0, 3)).map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                    <span className="truncate">{item.title}</span>
                    {item.time && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {item.time}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {todayList.length > 3 && (
                <button
                  onClick={() => setShowAllToday((v) => !v)}
                  className="mt-3 w-full rounded-md border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  {showAllToday ? "Ver menos" : `Ver mais (${todayList.length - 3})`}
                </button>
              )}
            </>
          )}
        </div>
      </section>


      {/* Colunas por empresa */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {visibleSources.map((s) => {
          const list = tasks.filter((t) => t.source === s.key && t.status !== "done");
          const late = list.filter(isOverdue).length;
          const links = access.filter((a) => a.source === s.key && a.url);
          return (
            <div key={s.key} className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${SOURCE_DOT[s.key]}`} />
                <p className="text-sm font-medium">{s.label}</p>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{list.length}</span>
                <span className="text-xs text-muted-foreground">pendências</span>
              </div>
              {late > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs text-reuniao">
                  <AlertTriangle className="h-3 w-3" /> {late} atrasada(s)
                </p>
              )}
              <div className="mt-3 space-y-1">
                {links.slice(0, 3).map((l) => (
                  <a
                    key={l.id}
                    href={l.url!}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" /> {l.label}
                  </a>
                ))}
              </div>
              <button
                onClick={() => setDrawer(s.key)}
                className={`mt-3 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs ${SOURCE_CHIP[s.key]}`}
              >
                <KeyRound className="h-3 w-3" /> Acessos
              </button>
            </div>
          );
        })}
      </section>

      {/* Gráfico semanal por empresa */}
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">Tarefas da semana</h2>
            <p className="text-xs text-muted-foreground">Distribuição por empresa</p>
          </div>
          <Link to="/tarefas" className="text-xs text-muted-foreground hover:text-foreground">
            ver tudo
          </Link>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : weekStats.total === 0 ? (
          <p className="text-sm text-muted-foreground">Sem tarefas nesta semana.</p>
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <div className="relative h-48 w-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={bySource}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {bySource.map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, _n, item) => {
                      const p = item?.payload as { done: number; pending: number } | undefined;
                      return [`${value} (${p?.done ?? 0} feitas)`, item?.payload?.name];
                    }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-semibold leading-none">{weekStats.pct}%</span>
                <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  concluído
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {weekStats.done}/{weekStats.total}
                </span>
              </div>
            </div>
            <ul className="w-full flex-1 space-y-2 text-sm">
              {bySource.map((w) => {
                const pct = w.value === 0 ? 0 : Math.round((w.done / w.value) * 100);
                return (
                  <li key={w.key} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: w.fill }}
                      />
                      <span className="text-sm">{w.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {w.done}/{w.value} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: w.fill }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {drawer && <AccessDrawer source={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
