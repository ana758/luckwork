import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SyncGoogleButton } from "@/components/SyncGoogleButton";
import { useMeetings, useTasks } from "@/lib/queries";
import { SOURCE_DOT } from "@/lib/sources";

export const Route = createFileRoute("/_authenticated/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário · Anora" },
      {
        name: "description",
        content: "Visão mensal com tarefas e reuniões de todas as empresas em um só lugar.",
      },
      { property: "og:title", content: "Calendário · Anora" },
      { property: "og:description", content: "Visão mensal de tarefas e reuniões." },
    ],
  }),
  component: CalendarPage,
});

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();

  const days = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const todayKey = new Date().toISOString().slice(0, 10);

  function itemsFor(key: string) {
    return [
      ...meetings
        .filter((m) => m.starts_at.slice(0, 10) === key)
        .map((m) => ({ id: m.id, title: m.title, dot: "bg-reuniao" })),
      ...tasks
        .filter((t) => t.due_date === key)
        .map((t) => ({ id: t.id, title: t.title, dot: SOURCE_DOT[t.source] })),
    ];
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Calendário</h1>
        <button
          aria-label="Mês anterior"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="rounded-md border p-1.5 hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-36 text-center text-sm font-medium capitalize">
          {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </span>
        <button
          aria-label="Próximo mês"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="rounded-md border p-1.5 hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </header>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b text-center text-[11px] text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const items = itemsFor(key);
            const muted = d.getMonth() !== cursor.getMonth();
            return (
              <div
                key={key}
                className={`min-h-20 border-b border-r p-1.5 last:border-r-0 ${muted ? "bg-secondary/30" : ""}`}
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
                    <div key={i.id} className="flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${i.dot}`} />
                      <span className="truncate text-[10px] text-muted-foreground">{i.title}</span>
                    </div>
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
    </div>
  );
}
