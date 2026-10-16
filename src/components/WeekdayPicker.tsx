/** Escolha de dias da semana (e por quantas semanas) para rotinas. */
const DAYS: [number, string][] = [
  [1, "seg"],
  [2, "ter"],
  [3, "qua"],
  [4, "qui"],
  [5, "sex"],
  [6, "sáb"],
  [0, "dom"],
];

export function WeekdayPicker({
  weekdays,
  setWeekdays,
  weeks,
  setWeeks,
}: {
  weekdays: number[];
  setWeekdays: (v: number[]) => void;
  weeks: number;
  setWeeks: (v: number) => void;
}) {
  return (
    <div className="mb-3 space-y-2 rounded-md border bg-secondary/30 p-2">
      <div className="flex flex-wrap gap-1">
        {DAYS.map(([n, l]) => {
          const on = weekdays.includes(n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== n) : [...weekdays, n])}
              className={`rounded-md border px-2 py-1 text-xs ${
                on ? "border-foreground bg-card font-medium" : "text-muted-foreground"
              }`}
            >
              {l}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1 text-[11px]">
        <button
          type="button"
          onClick={() => setWeekdays([0, 1, 2, 3, 4, 5, 6])}
          className="rounded-md border px-2 py-0.5 hover:bg-accent"
        >
          Todos os dias
        </button>
        <button
          type="button"
          onClick={() => setWeekdays([1, 2, 3, 4, 5])}
          className="rounded-md border px-2 py-0.5 hover:bg-accent"
        >
          Seg a sex
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Por</span>
        <select
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          {[2, 4, 8, 12].map((w) => (
            <option key={w} value={w}>
              {w} semanas
            </option>
          ))}
        </select>
        <span>a partir da data acima. Cada dia vira uma tarefa própria.</span>
      </div>
    </div>
  );
}
