import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { withAuthRetry } from "@/lib/auth-retry";
import { SOURCES, SOURCE_DOT, RECURRENCE_LABEL, type SourceKey, type Recurrence } from "@/lib/sources";

/** Nova tarefa criada direto no calendário (dia e horário já preenchidos). */
export function NewTaskModal({
  defaultDate,
  defaultTime,
  onClose,
}: {
  defaultDate: string;
  defaultTime?: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime ?? "");
  const [durationMin, setDurationMin] = useState(60);
  const [source, setSource] = useState<SourceKey>("pessoal");
  const [recurrence, setRecurrence] = useState<Recurrence | "weekdays">("none");
  // Rotina por dias da semana: 0=dom … 6=sáb. Padrão: segunda a sexta.
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [weeks, setWeeks] = useState(4);
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Título é obrigatório.");

      // Rotina por dias da semana: cria uma tarefa por ocorrência (uma série
      // sem fins de semana, por exemplo). Cada uma pode ser editada ou concluída
      // sozinha, sem mexer nas outras.
      if (recurrence === "weekdays") {
        if (!date) throw new Error("Escolha a data de início da rotina.");
        if (weekdays.length === 0) throw new Error("Escolha pelo menos um dia da semana.");
        const [y, m, d] = date.split("-").map(Number);
        const pad = (n: number) => String(n).padStart(2, "0");
        const dates: string[] = [];
        for (let i = 0; i < weeks * 7; i++) {
          const day = new Date(y, m - 1, d + i);
          if (weekdays.includes(day.getDay())) {
            dates.push(`${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`);
          }
        }
        if (dates.length === 0) throw new Error("Nenhuma data cai nesses dias.");
        const { data: rows, error } = await supabase
          .from("tasks")
          .insert(
            dates.map((due) => ({
              title: title.trim(),
              source,
              notes: notes.trim() || null,
              due_date: due,
              start_date: due,
              due_time: time ? `${time}:00` : null,
              recurrence: "none" as Recurrence,
              duration_min: time ? durationMin : null,
            })),
          )
          .select("id");
        if (error) throw new Error(error.message);
        // Reflete no Google em segundo plano, uma por vez, sem travar a tela.
        void (async () => {
          const { syncTaskToCalendar } = await import("@/lib/task-calendar.functions");
          for (const r of rows ?? []) {
            try {
              await syncTaskToCalendar({ data: { taskId: r.id } });
            } catch {
              /* segue só na LUCK */
            }
          }
        })();
        return dates.length;
      }

      const created = await withAuthRetry<{ id: string }>(() =>
        supabase
          .from("tasks")
          .insert({
            title: title.trim(),
            source,
            notes: notes.trim() || null,
            due_date: date || null,
            start_date: date || null,
            due_time: date && time ? `${time}:00` : null,
            recurrence: recurrence as Recurrence,
            duration_min: date && time ? durationMin : null,
          })
          .select("id")
          .single(),
      );
      // Reflete no Google Agenda em segundo plano — não trava o salvamento.
      void import("@/lib/task-calendar.functions")
        .then(({ syncTaskToCalendar }) => syncTaskToCalendar({ data: { taskId: created.id } }))
        .catch(() => {
          /* segue só na LUCK */
        });
    },
    onSuccess: (count) => {
      toast.success(typeof count === "number" ? `Rotina criada: ${count} tarefas` : "Tarefa criada");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-4 md:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-medium">Nova tarefa</h3>

        <label className="text-xs text-muted-foreground">Título</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Horário (opcional)</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <label className="text-xs text-muted-foreground">Duração</label>
        <select
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`}
            </option>
          ))}
        </select>

        <label className="text-xs text-muted-foreground">Repetição</label>
        <select
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as Recurrence | "weekdays")}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
            <option key={r} value={r}>
              {RECURRENCE_LABEL[r]}
            </option>
          ))}
          <option value="weekdays">Dias da semana…</option>
        </select>

        {recurrence === "weekdays" && (
          <div className="mb-3 space-y-2 rounded-md border bg-secondary/30 p-2">
            <div className="flex flex-wrap gap-1">
              {[
                [1, "seg"],
                [2, "ter"],
                [3, "qua"],
                [4, "qui"],
                [5, "sex"],
                [6, "sáb"],
                [0, "dom"],
              ].map(([n, l]) => {
                const on = weekdays.includes(n as number);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      setWeekdays((prev) =>
                        prev.includes(n as number) ? prev.filter((x) => x !== n) : [...prev, n as number],
                      )
                    }
                    className={`rounded-md border px-2 py-1 text-xs ${
                      on ? "border-foreground bg-card font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
        )}

        <label className="text-xs text-muted-foreground">Empresa</label>
        <div className="mb-3 mt-1 grid grid-cols-4 gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={`rounded-md border px-2 py-1.5 text-xs ${
                source === s.key ? "border-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              <span className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${SOURCE_DOT[s.key]}`} />
              {s.label}
            </button>
          ))}
        </div>

        <label className="text-xs text-muted-foreground">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="mb-3 mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {save.isPending ? "Salvando…" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}
