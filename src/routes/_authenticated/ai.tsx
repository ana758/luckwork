import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, ListTodo } from "lucide-react";
import { useMeetings, useTasks } from "@/lib/queries";
import { isOverdue, SOURCE_DOT } from "@/lib/sources";
import { AiMemoryCard } from "@/components/AiMemoryCard";
import { AiConsole } from "@/components/AiConsole";

export const Route = createFileRoute("/_authenticated/ai")({
  head: () => ({
    meta: [
      { title: "IA · LUCK" },
      {
        name: "description",
        content: "Resumo do dia, atrasos, reuniões e sugestões práticas geradas por IA.",
      },
      { property: "og:title", content: "IA · LUCK" },
      { property: "og:description", content: "Resumo do dia e sugestões práticas." },
    ],
  }),
  component: AIPage,
});

function AIPage() {
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();

  const summary = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const overdue = tasks.filter((t) => isOverdue(t));
    const todayTasks = tasks.filter(
      (t) =>
        t.due_date &&
        t.status !== "done" &&
        new Date(`${t.due_date}T12:00:00`).toDateString() === today.toDateString(),
    );
    const meetingsToday = meetings.filter((m) => {
      const d = new Date(m.starts_at);
      return d >= today && d < tomorrow;
    });
    const stuck = tasks.filter((t) => {
      if (t.status === "done") return false;
      const days = (Date.now() - new Date(t.updated_at).getTime()) / 86400000;
      return days > 7;
    });

    return { overdue, todayTasks, meetingsToday, stuck };
  }, [tasks, meetings]);

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col gap-4 pb-6 md:min-h-[calc(100vh-6rem)]">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Espaço IA</h1>
        <p className="text-sm text-muted-foreground">
          Converse, peça resumo, adicione tarefas ou apague o que não precisa mais.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Atrasadas"
          value={summary.overdue.length}
          tone={summary.overdue.length > 0 ? "danger" : "muted"}
        />
        <SummaryCard
          icon={<ListTodo className="h-4 w-4" />}
          label="Para hoje"
          value={summary.todayTasks.length}
          tone="default"
        />
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Reuniões hoje"
          value={summary.meetingsToday.length}
          tone="default"
        />
      </div>

      {(summary.overdue.length > 0 || summary.stuck.length > 0) && (
        <div className="rounded-xl border border-reuniao/30 bg-reuniao/5 p-3 text-sm">
          <p className="mb-2 font-medium text-reuniao">Precisam da sua atenção</p>
          <ul className="space-y-1">
            {summary.overdue.slice(0, 3).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[t.source]}`} />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-muted-foreground">
                  venceu {new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
            {summary.stuck.slice(0, 2).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[t.source]}`} />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-muted-foreground">arrastando há dias</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AiConsole />

      <AiMemoryCard />
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "default" | "danger" | "muted";
}) {
  const toneClass =
    tone === "danger"
      ? "border-reuniao/40 bg-reuniao/5 text-reuniao"
      : tone === "muted"
        ? "border-border bg-card text-muted-foreground"
        : "border-border bg-card text-foreground";
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${toneClass}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background/60">
        {icon}
      </div>
      <div>
        <p className="text-xs opacity-80">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </div>
    </div>
  );
}
