import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SOURCES, type SourceKey } from "@/lib/sources";

type Kind = "task" | "meeting";

export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [source, setSource] = useState<SourceKey>("pessoal");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Escreva o que precisa ser feito.");
      if (kind === "task") {
        const { error } = await supabase.from("tasks").insert({
          title: title.trim(),
          source,
          due_date: when || null,
        });
        if (error) throw new Error(error.message);
      } else {
        if (!when) throw new Error("Escolha a data e hora da reunião.");
        const { error } = await supabase.from("meetings").insert({
          title: title.trim(),
          source,
          starts_at: new Date(when).toISOString(),
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(kind === "task" ? "Tarefa criada" : "Reunião criada");
      setTitle("");
      setWhen("");
      setOpen(false);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Adicionar"
        className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 md:bottom-6 md:right-6"
      >
        <Plus className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-4 md:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex gap-1 rounded-lg bg-secondary p-1 text-sm">
              {(["task", "meeting"] as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded-md px-2 py-1.5 ${
                    kind === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {k === "task" ? "Tarefa" : "Reunião"}
                </button>
              ))}
            </div>

            <label className="text-xs text-muted-foreground">O quê</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={kind === "task" ? "Ex.: revisar contrato" : "Ex.: call com fornecedor"}
              className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <label className="text-xs text-muted-foreground">
              {kind === "task" ? "Prazo (opcional)" : "Quando"}
            </label>
            <input
              type={kind === "task" ? "date" : "datetime-local"}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <label className="text-xs text-muted-foreground">Empresa</label>
            <div className="mb-4 mt-1 grid grid-cols-4 gap-1">
              {SOURCES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    source === s.key ? "border-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${
                      s.key === "angi"
                        ? "bg-angi"
                        : s.key === "devore"
                          ? "bg-devore"
                          : s.key === "bruna"
                            ? "bg-bruna"
                            : "bg-pessoal"
                    }`}
                  />
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
