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
  const [source, setSource] = useState<SourceKey>("pessoal");
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Título é obrigatório.");
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
            recurrence,
          })
          .select("id")
          .single(),
      );
      // Reflete no Google Agenda quando houver contas conectadas.
      try {
        const { syncTaskToCalendar } = await import("@/lib/task-calendar.functions");
        await syncTaskToCalendar({ data: { taskId: created.id } });
      } catch {
        /* segue só na LUCK */
      }
    },
    onSuccess: () => {
      toast.success("Tarefa criada");
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

        <label className="text-xs text-muted-foreground">Repetição</label>
        <select
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as Recurrence)}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
            <option key={r} value={r}>
              {RECURRENCE_LABEL[r]}
            </option>
          ))}
        </select>

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
