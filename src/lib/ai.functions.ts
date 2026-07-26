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
              "As empresas são Angi, Devore, Brand.Pe e Pessoal. Não invente dados que não estejam no JSON.",
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

// ---------------------------------------------------------------------------
// aiAction: interpreta linguagem natural e cria tarefa ou reunião
// ---------------------------------------------------------------------------

type ActionResult = {
  intent: "add_task" | "add_meeting" | "chat";
  reply: string;
  created?: { kind: "task" | "meeting"; title: string; when?: string };
};

export const aiAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) => {
    if (!input?.text?.trim()) throw new Error("Mensagem vazia.");
    return { text: input.text.trim() };
  })
  .handler(async ({ data, context }): Promise<ActionResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("IA indisponível no momento.");

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const tz = "America/Sao_Paulo";

    const system = [
      "Você é a assistente da Ana. Interprete a mensagem e responda APENAS um JSON válido, sem markdown.",
      `Hoje é ${todayStr} (fuso ${tz}).`,
      "Empresas (source): 'angi', 'devore', 'bruna' (Brand.Pe), 'pessoal'. Se a mensagem mencionar 'pessoal' ou nome pessoal, use 'pessoal'. Para Brand.Pe use 'bruna'.",
      "Se o usuário pedir para ADICIONAR/CRIAR uma tarefa ou compromisso, escolha o intent apropriado:",
      "- 'add_task' para tarefa (sem horário obrigatório).",
      "- 'add_meeting' para reunião/compromisso com horário.",
      "- 'chat' para qualquer outra pergunta.",
      "Formato de resposta (JSON):",
      `{"intent":"add_task","reply":"texto curto de confirmação em pt-BR","task":{"title":"...","source":"pessoal","priority":"media","status":"todo","start_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD","notes":"opcional","location":"opcional"}}`,
      `{"intent":"add_meeting","reply":"...","meeting":{"title":"...","source":"pessoal","starts_at":"YYYY-MM-DDTHH:mm:00-03:00","ends_at":"YYYY-MM-DDTHH:mm:00-03:00 ou null","location":"opcional","people":"opcional","notes":"opcional","meeting_type":"Compromisso"}}`,
      `{"intent":"chat","reply":"resposta curta"}`,
      "Se falar 'falar com X' sem horário, use add_task. Se disser 'reunião' ou horário explícito, add_meeting.",
      "Nunca invente dados. Datas relativas ('amanhã', 'hoje', '28/07') resolva com base na data de hoje.",
    ].join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.text },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Muitas solicitações. Tente de novo em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados.");
    if (!res.ok) throw new Error(`Falha na IA (${res.status})`);

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { intent: "chat", reply: raw };
    }

    if (parsed.intent === "add_task" && parsed.task?.title) {
      const t = parsed.task;
      const { data: inserted, error } = await context.supabase
        .from("tasks")
        .insert({
          created_by: context.userId,
          title: String(t.title),
          notes: t.notes ?? null,
          source: (t.source ?? "pessoal") as any,
          status: (t.status ?? "todo") as any,
          priority: (t.priority ?? "media") as any,
          start_date: t.start_date ?? null,
          due_date: t.due_date ?? null,
          recurrence: "none" as any,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Não consegui salvar a tarefa: ${error.message}`);
      // Se marcou como Devore, cria também no DAILY GESTÃO do Notion
      if ((t.source ?? "pessoal") === "devore" && inserted?.id) {
        try {
          const { createDailyGestaoPage } = await import("./notion.server");
          const notion = await createDailyGestaoPage({
            title: String(t.title),
            dueDate: t.due_date ?? t.start_date ?? null,
            status: (t.status ?? "todo") as any,
          });
          if (notion?.pageId) {
            await context.supabase
              .from("tasks")
              .update({
                external_system: "notion",
                external_id: notion.pageId,
                external_url: notion.url,
              })
              .eq("id", inserted.id);
          }
        } catch {
          // segue mesmo se Notion falhar
        }
      }

      // Se tem data, também empurra pro Google Agenda como all-day
      if (t.due_date || t.start_date) {
        try {
          const { runCalendarPush } = await import("./gcal-sync.server");
          const res = await runCalendarPush(context.supabase, context.userId, {
            title: String(t.title),
            startsAt: `${t.due_date ?? t.start_date}T09:00:00`,
            allDay: true,
            notes: t.notes ?? null,
            location: t.location ?? null,
            source: t.source ?? "pessoal",
          });
          if (res.eventId && inserted?.id) {
            const src = t.source ?? "pessoal";
            if (src !== "devore" && src !== "angi") {
              await context.supabase
                .from("tasks")
                .update({ external_url: res.url, external_system: "google_calendar" })
                .eq("id", inserted.id);
            }
          }
        } catch {
          // segue mesmo se Google falhar
        }
      }
      return {
        intent: "add_task",
        reply: parsed.reply ?? `Tarefa "${t.title}" adicionada.`,
        created: { kind: "task", title: t.title, when: t.due_date ?? t.start_date },
      };
    }

    if (parsed.intent === "add_meeting" && parsed.meeting?.title && parsed.meeting?.starts_at) {
      const m = parsed.meeting;
      let googleId: string | null = null;
      let googleAccount: string | null = null;
      let externalUrl: string | null = null;
      try {
        const { runCalendarPush } = await import("./gcal-sync.server");
        const res = await runCalendarPush(context.supabase, context.userId, {
          title: String(m.title),
          startsAt: m.starts_at,
          endsAt: m.ends_at ?? null,
          notes: m.notes ?? null,
          location: m.location ?? null,
          source: m.source ?? "pessoal",
        });
        googleId = res.eventId ?? null;
        googleAccount = res.calendarId ?? null;
        externalUrl = res.url ?? null;
      } catch {
        // segue mesmo se falhar
      }
      const { error } = await context.supabase.from("meetings").insert({
        created_by: context.userId,
        title: String(m.title),
        source: (m.source ?? "pessoal") as any,
        starts_at: m.starts_at,
        ends_at: m.ends_at ?? null,
        location: m.location ?? null,
        people: m.people ?? null,
        notes: m.notes ?? null,
        meeting_type: m.meeting_type ?? "Compromisso",
        status: "todo",
        google_event_id: googleId,
        google_account: googleAccount,
        external_url: externalUrl,
      });
      if (error) throw new Error(`Não consegui salvar o compromisso: ${error.message}`);
      return {
        intent: "add_meeting",
        reply: parsed.reply ?? `Compromisso "${m.title}" adicionado${googleId ? " (também no Google Agenda)" : ""}.`,
        created: { kind: "meeting", title: m.title, when: m.starts_at },
      };
    }

    return { intent: "chat", reply: parsed.reply ?? "Ok." };
  });

