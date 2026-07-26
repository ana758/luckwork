import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getDailyBriefing } from "@/lib/ai.functions";

export const Route = createFileRoute("/_authenticated/ai")({
  head: () => ({
    meta: [
      { title: "IA · Meu Hub" },
      {
        name: "description",
        content: "Resumo do dia, atrasos, reuniões e sugestões práticas geradas por IA.",
      },
      { property: "og:title", content: "IA · Meu Hub" },
      { property: "og:description", content: "Resumo do dia e sugestões práticas." },
    ],
  }),
  component: AIPage,
});

function AIPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const ask = useMutation({
    mutationFn: async (q?: string) => getDailyBriefing({ data: { question: q } }),
    onSuccess: (res) => setAnswer(res.text),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Espaço IA</h1>
        <p className="text-sm text-muted-foreground">
          Resumo do dia, o que está atrasado e sugestões para destravar tarefas.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => ask.mutate(undefined)}
          disabled={ask.isPending}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {ask.isPending ? "Analisando…" : "Resumo do dia"}
        </button>
        <button
          onClick={() => ask.mutate("Quais tarefas estão arrastando há muito tempo e como destravar?")}
          disabled={ask.isPending}
          className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
        >
          Tarefas travadas
        </button>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <label className="text-xs text-muted-foreground">Pergunte algo</label>
        <div className="mt-1 flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={400}
            placeholder="Ex.: o que priorizar na Angi esta semana?"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => question.trim() && ask.mutate(question.trim())}
            disabled={ask.isPending}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            Enviar
          </button>
        </div>
      </div>

      {answer && (
        <article className="whitespace-pre-wrap rounded-xl border bg-card p-4 text-sm leading-relaxed">
          {answer}
        </article>
      )}

      <p className="text-xs text-muted-foreground">
        A leitura dos e-mails entra na próxima etapa, junto com as conexões do Google, Jira e
        Notion.
      </p>
    </div>
  );
}
