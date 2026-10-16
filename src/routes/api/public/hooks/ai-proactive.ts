import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { notifyAll } from "@/lib/notify.server";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/**
 * IA proativa da LUCK.
 * Analisa rotina, tarefas repetidas/paradas e a agenda, e — sem que a Ana peça —
 * manda uma pergunta curta por push ("posso fazer X pra você?").
 * Roda por cron algumas vezes ao dia; nunca repete a mesma sugestão no mesmo dia.
 */
export const Route = createFileRoute("/api/public/hooks/ai-proactive")({
  server: {
    handlers: {
      POST: async () => {
        const { aiChat, hasAiProvider } = await import("@/lib/ai-fallback.server");
        if (!hasAiProvider()) return Response.json({ ok: false, error: "sem chave de IA" });

        const sb = admin();
        const today = new Date().toISOString().slice(0, 10);
        const tag = `ai-proactive-${today.replace(/-/g, "")}-${new Date().getUTCHours()}`;

        const { data: already } = await sb
          .from("pending_pushes")
          .select("tag")
          .eq("tag", tag)
          .limit(1);
        if ((already ?? []).length > 0) return Response.json({ ok: true, skipped: true });

        const in3 = new Date(Date.now() + 3 * 86400000).toISOString();
        const [{ data: tasks }, { data: meetings }, { data: memories }] = await Promise.all([
          sb
            .from("tasks")
            .select("title, source, status, priority, due_date, status_changed_at, updated_at, created_at")
          .neq("source", "devore")
            .neq("status", "done")
            .order("due_date", { ascending: true })
            .limit(300),
          sb
            .from("meetings")
            .select("title, source, starts_at, external_url")
          .neq("source", "devore")
            .gte("starts_at", new Date().toISOString())
            .lte("starts_at", in3)
            .neq("hidden", true)
            .limit(60),
          sb.from("ai_memory").select("content").order("created_at", { ascending: false }).limit(40),
        ]);

        const prompt = [
          `Hoje é ${today}.`,
          `Memória sobre a Ana: ${JSON.stringify((memories ?? []).map((m) => m.content))}`,
          `Tarefas em aberto: ${JSON.stringify(tasks ?? [])}`,
          `Reuniões dos próximos 3 dias: ${JSON.stringify(meetings ?? [])}`,
        ].join("\n\n");

        const res = await aiChat({
            model: "google/gemini-3.6-flash",
            messages: [
              {
                role: "system",
                content:
                  "Você é a assistente proativa da Ana (LUCK). Analise rotina, tarefas repetidas ou duplicadas, tarefas paradas no mesmo board, " +
                  "vencimentos e conflitos de agenda. Escolha UMA única observação realmente útil e ofereça ajuda em forma de pergunta curta " +
                  '(ex.: "Percebi 3 tarefas iguais na Angi — posso juntar em uma só?"). ' +
                  'Responda SOMENTE JSON: {"vale_notificar": true|false, "titulo": "até 60 caracteres", "mensagem": "até 140 caracteres"}. ' +
                  "Se não houver nada relevante, vale_notificar = false. Nunca invente dados.",
              },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
        });

        if (!res.ok) {
          return Response.json({ ok: false, error: await res.text() }, { status: 200 });
        }
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        let parsed: { vale_notificar?: boolean; titulo?: string; mensagem?: string } = {};
        try {
          parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
        } catch {
          return Response.json({ ok: false, error: "resposta inválida" });
        }
        if (!parsed.vale_notificar || !parsed.titulo) {
          return Response.json({ ok: true, sent: false });
        }

        const title = `🤖 ${parsed.titulo}`.slice(0, 90);
        const body = (parsed.mensagem ?? "").slice(0, 160);
        await notifyAll({ title, body, url: "/ai", tag });
        await sb.from("notifications").insert({ title, body });

        return Response.json({ ok: true, sent: true, title, body });
      },
    },
  },
});
