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

function CalendarPage() {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();

  const todayKey = fmtKey(new Date());

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
                <div key={key} className="min-h-[60vh] space-y-1 border-r p-2 last:border-r-0">
                  {items.length === 0 && (
                    <div className="pt-4 text-center text-[11px] text-muted-foreground">
                      Sem itens
                    </div>
                  )}
                  {items.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-start gap-1.5 rounded-md border bg-background p-1.5"
                    >
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i.dot}`} />
                      <span className="text-xs leading-tight">{i.title}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
