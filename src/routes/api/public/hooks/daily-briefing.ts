import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { notifyAll } from "@/lib/notify.server";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const SOURCE_LABEL: Record<string, string> = {
  angi: "Angi",
  devore: "Devore",
  bruna: "Brand.Pe",
  pessoal: "Pessoal",
};

async function callGemini(prompt: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return "";
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Você é a LUCK, assistente pessoal da Ana. Fale em português, direto e curto." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export const Route = createFileRoute("/api/public/hooks/daily-briefing")({
  server: {
    handlers: {
      POST: async () => {
        const sb = admin();
        const today = new Date();
        const iso = today.toISOString().slice(0, 10);
        const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);

        // Reuniões de hoje
        const start = `${iso}T00:00:00.000Z`;
        const end = `${tomorrow}T00:00:00.000Z`;
        const { data: meetings } = await sb
          .from("meetings")
          .select("title, source, starts_at, location")
          .gte("starts_at", start)
          .lt("starts_at", end)
          .neq("hidden", true)
          .order("starts_at");

        // Tarefas em aberto (todo/doing) com due hoje ou atrasadas
        const { data: tasks } = await sb
          .from("tasks")
          .select("title, source, due_date, status, priority")
          .in("status", ["todo", "doing", "onhold"])
          .or(`due_date.lte.${iso},due_date.is.null`)
          .order("priority");

        const meetingLines = (meetings ?? []).map((m) => {
          const hh = new Date(m.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
          return `- ${hh} [${SOURCE_LABEL[m.source] || m.source}] ${m.title}${m.location ? ` @ ${m.location}` : ""}`;
        });

        const taskLines = (tasks ?? []).slice(0, 15).map(
          (t) => `- [${SOURCE_LABEL[t.source] || t.source}] ${t.title}${t.due_date ? ` (vence ${t.due_date})` : ""}`,
        );

        const prompt = `Monte um resumo curto do dia (${iso}) para a Ana. Em 3-5 frases, tom direto.

Reuniões de hoje:
${meetingLines.join("\n") || "(nenhuma)"}

Tarefas em aberto:
${taskLines.join("\n") || "(nenhuma)"}

Formato: comece com contagens, cite a próxima reunião, destaque 1-2 tarefas críticas. Sem emojis em excesso.`;

        let summary = await callGemini(prompt);
        if (!summary) {
          summary = `Bom dia! ${meetings?.length ?? 0} reunião(ões) e ${tasks?.length ?? 0} tarefa(s) em aberto.`;
        }

        await notifyAll({
          title: "☀️ Resumo do dia",
          body: summary.slice(0, 240),
          url: "/ai",
          tag: `briefing-${iso}`,
        });

        return Response.json({ ok: true, summary });
      },
    },
  },
});
