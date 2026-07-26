import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDailyBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { question?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("IA indisponível no momento.");

    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const [{ data: tasks }, { data: meetings }] = await Promise.all([
      context.supabase
        .from("tasks")
        .select("title, source, status, priority, start_date, due_date, updated_at, recurrence")
        .neq("status", "done")
        .order("due_date", { ascending: true })
        .limit(120),
      context.supabase
        .from("meetings")
        .select("title, source, starts_at, meeting_type, people")
        .gte("starts_at", `${today}T00:00:00`)
        .lte("starts_at", `${in7}T23:59:59`)
        .order("starts_at", { ascending: true })
        .limit(40),
    ]);

    const prompt = [
      `Hoje é ${today}.`,
      `Tarefas em aberto (JSON): ${JSON.stringify(tasks ?? [])}`,
      `Reuniões dos próximos 7 dias (JSON): ${JSON.stringify(meetings ?? [])}`,
      data.question
        ? `Pergunta específica da usuária: ${data.question}`
        : "Gere o resumo do dia.",
    ].join("\n\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Você é a assistente executiva da Ana. Responda em português do Brasil, direto e curto, em markdown. " +
              "Estruture assim quando fizer o resumo do dia: '## Resumo do dia' (2 linhas), '## Atrasado' (lista), " +
              "'## Hoje e amanhã' (lista), '## Reuniões' (lista), '## Sugestões' (2 a 4 ações práticas, " +
              "incluindo o que fazer com tarefas que estão arrastando há muito tempo). " +
              "As empresas são Angi, Devore, Bruna e Pessoal. Não invente dados que não estejam no JSON.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Muitas solicitações. Tente de novo em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
    if (!res.ok) throw new Error(`Falha na IA (${res.status})`);

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: json.choices?.[0]?.message?.content ?? "Sem resposta." };
  });
