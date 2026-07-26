import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AlertTriangle, ExternalLink, KeyRound } from "lucide-react";
import { AccessDrawer } from "@/components/AccessDrawer";
import { endOfWeek, startOfWeek, useAccessEntries, useMeetings, useTasks } from "@/lib/queries";
import {
  isOverdue,
  SOURCES,
  SOURCE_CHIP,
  SOURCE_DOT,
  type SourceKey,
  type Task,
} from "@/lib/sources";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Início · Anora" },
      {
        name: "description",
        content: "Painel com pendências por empresa, reuniões do dia e progresso semanal.",
      },
      { property: "og:title", content: "Início · Anora" },
      { property: "og:description", content: "Pendências por empresa e progresso da semana." },
    ],
  }),
  component: Dashboard,
});

function inWeek(task: Task) {
  if (task.recurrence !== "none") return true;
  const ref = task.due_date ?? task.start_date;
  if (!ref) return true;
  const d = new Date(`${ref}T12:00:00`);
  return d >= startOfWeek() && d <= endOfWeek();
}

function Dashboard() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const { data: access = [] } = useAccessEntries();
  const [drawer, setDrawer] = useState<SourceKey | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const todayItems = useMemo(() => {
    const t = tasks.filter((x) => x.due_date === today && x.status !== "done");
    const m = meetings.filter((x) => x.starts_at.slice(0, 10) === today);
    return { t, m };
  }, [tasks, meetings, today]);

  const weekly = useMemo(() => {
    const week = tasks.filter(inWeek);
    const done = week.filter((t) => t.status === "done").length;
    const doing = week.filter((t) => t.status === "doing" || t.status === "onhold").length;
    const todo = week.filter((t) => t.status === "todo").length;
    return [
      { name: "Concluídas", value: done, fill: "var(--angi)" },
      { name: "Em andamento", value: doing, fill: "var(--devore)" },
      { name: "Não iniciadas", value: todo, fill: "var(--muted-foreground)" },
    ];
  }, [tasks]);

  const weekTotal = weekly.reduce((a, b) => a + b.value, 0);

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

      {/* Hoje */}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Hoje</h2>
        {todayItems.t.length === 0 && todayItems.m.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada marcado para hoje.</p>
        ) : (
          <ul className="space-y-2">
            {todayItems.m.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full bg-reuniao" />
                <span className="truncate">{m.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {new Date(m.starts_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
            {todayItems.t.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_DOT[t.source]}`} />
                <span className="truncate">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Colunas por empresa */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SOURCES.map((s) => {
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

      {/* Gráfico semanal */}
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Tarefas da semana</h2>
          <Link to="/tarefas" className="text-xs text-muted-foreground hover:text-foreground">
            ver tudo
          </Link>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : weekTotal === 0 ? (
          <p className="text-sm text-muted-foreground">Sem tarefas nesta semana.</p>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-44 w-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={weekly}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {weekly.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2 text-sm">
              {weekly.map((w) => (
                <li key={w.name} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: w.fill }}
                  />
                  <span className="text-muted-foreground">{w.name}</span>
                  <span className="font-medium">{w.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {drawer && <AccessDrawer source={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
