import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deleteGoogleEvent } from "@/lib/gcal.functions";
import { syncTaskToCalendar } from "@/lib/task-calendar.functions";
import { SOURCES, SOURCE_DOT, type Task, type SourceKey } from "@/lib/sources";

export function TaskEditModal({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [dueTime, setDueTime] = useState((task.due_time ?? "").slice(0, 5));
  const [source, setSource] = useState<SourceKey>(task.source);
  const [notes, setNotes] = useState(task.notes ?? "");
  const initialDest =
    (task as unknown as { crm_destination?: "jira" | "crm" | "none" | null }).crm_destination ??
    (task.external_system === "crm_angi" ? "crm" : task.external_system === "jira" ? "jira" : "none");
  const [angiDest, setAngiDest] = useState<"jira" | "crm" | "none">(initialDest);
  const qc = useQueryClient();
  const delGoogle = useServerFn(deleteGoogleEvent);
  const syncCalendar = useServerFn(syncTaskToCalendar);

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Título é obrigatório.");
      const { error } = await supabase
        .from("tasks")
        .update({
          title: title.trim(),
          source,
          notes: notes.trim() || null,
          due_date: dueDate || null,
          due_time: dueDate && dueTime ? `${dueTime}:00` : null,
          crm_destination: source === "angi" ? angiDest : null,
        })
        .eq("id", task.id);
      if (error) throw new Error(error.message);
      if (source !== task.source) {
        const { learnSourceRule } = await import("@/lib/learn-source");
        await learnSourceRule(title.trim(), source);
      }
      // Qualquer alteração (nome, data, horário, notas) reflete no Google Agenda.
      try {
        const r = await syncCalendar({ data: { taskId: task.id } });
        return { synced: r.synced };
      } catch (e) {
        toast.error(`Salvo na LUCK, mas o calendário não atualizou: ${(e as Error).message}`);
        return { synced: false };
      }
    },
    onSuccess: (r) => {
      toast.success(r?.synced ? "Atualizada na LUCK e no calendário" : "Tarefa atualizada");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { data: rowData } = await supabase
        .from("tasks")
        .select("google_event_id, google_account")
        .eq("id", task.id)
        .maybeSingle();
      const row = rowData as { google_event_id?: string | null; google_account?: string | null } | null;

      let googleOk = true;
      let wasLinked = false;
      if (row?.google_event_id && row?.google_account) {
        wasLinked = true;
        try {
          await delGoogle({
            data: { googleAccount: row.google_account, googleEventId: row.google_event_id },
          });
        } catch (e) {
          googleOk = false;
          toast.error(`Google Agenda: ${(e as Error).message}`);
        }
      }
      const { error } = await supabase.from("tasks").delete().eq("id", task.id);
      if (error) throw new Error(error.message);
      return { googleOk, wasLinked };
    },
    onSuccess: (r) => {
      toast.success(
        r.wasLinked
          ? r.googleOk
            ? "Apagada no LUCK e no Google Agenda"
            : "Apagada no LUCK (Google falhou)"
          : "Tarefa apagada",
      );
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
        <h3 className="mb-3 text-sm font-medium">Editar tarefa</h3>

        <label className="text-xs text-muted-foreground">Título</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="text-xs text-muted-foreground">Data</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

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
              <span
                className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${SOURCE_DOT[s.key]}`}
              />
              {s.label}
            </button>
          ))}
        </div>

        {source === "angi" && (
          <>
            <label className="text-xs text-muted-foreground">Destino Angi</label>
            <div className="mb-3 mt-1 grid grid-cols-3 gap-1">
              {(
                [
                  { key: "jira", label: "Jira" },
                  { key: "crm", label: "CRM Angi" },
                  { key: "none", label: "Só LUCK" },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  onClick={() => setAngiDest(o.key)}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    angiDest === o.key ? "border-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}


        <label className="text-xs text-muted-foreground">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder="Espaço livre — escreva o quanto quiser."
          className="mb-3 mt-1 min-h-[10rem] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
        />


        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (confirm("Apagar esta tarefa? Também será removida do Google Agenda quando vinculada."))
                remove.mutate();
            }}
            disabled={remove.isPending}
            className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/20 disabled:opacity-60"
          >
            {remove.isPending ? "Apagando…" : "Apagar"}
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
