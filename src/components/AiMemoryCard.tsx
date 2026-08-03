import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { addAiMemory, deleteAiMemory, listAiMemories } from "@/lib/ai.functions";

export function AiMemoryCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const { data: memories = [] } = useQuery({
    queryKey: ["ai-memory"],
    queryFn: () => listAiMemories(),
    staleTime: 60_000,
  });

  const add = useMutation({
    mutationFn: (content: string) => addAiMemory({ data: { content } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["ai-memory"] });
      toast.success("Aprendido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAiMemory({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-memory"] }),
  });

  return (
    <div className="rounded-2xl border bg-card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Brain className="h-4 w-4 text-primary" />
        <p className="flex-1 text-sm font-medium">
          Memória da IA{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({memories.length} {memories.length === 1 ? "aprendizado" : "aprendizados"})
          </span>
        </p>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            A LUCK guarda aqui suas preferências e correções e usa em todas as respostas. Você pode
            adicionar ou apagar o que quiser.
          </p>

          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) add.mutate(draft.trim());
              }}
              placeholder="Ex.: reuniões com Dr. Lázaro são pessoais"
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => draft.trim() && add.mutate(draft.trim())}
              disabled={add.isPending || !draft.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <ul className="space-y-1.5">
            {memories.map((m) => (
              <li
                key={m.id}
                className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-sm"
              >
                <span className="flex-1 leading-snug">{m.content}</span>
                {m.source === "auto" && (
                  <span className="mt-0.5 rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    aprendido
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove.mutate(m.id)}
                  className="mt-0.5 text-muted-foreground hover:text-destructive"
                  aria-label="Esquecer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {memories.length === 0 && (
              <li className="text-xs text-muted-foreground">
                Nada ainda — a IA vai aprendendo conforme você conversa com ela.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
