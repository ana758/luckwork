import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ImportantEmail = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  link: string;
  category: string;
  reason: string;
};

async function loadImportantEmails(): Promise<{ emails: ImportantEmail[]; error?: string }> {
  const errors: string[] = [];
  const inbox: Array<{
    id: string;
    from: string;
    fromEmail: string;
    subject: string;
    snippet: string;
    date: string;
    link: string;
  }> = [];

  if (process.env.GOOGLE_MAIL_API_KEY) {
    try {
      const { fetchRecentInbox } = await import("./gmail.server");
      const g = await fetchRecentInbox(40);
      for (const e of g) {
        inbox.push({
          id: `gmail:${e.id}`,
          from: e.from,
          fromEmail: e.fromEmail,
          subject: e.subject,
          snippet: e.snippet,
          date: e.date,
          link: e.link,
        });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Falha ao ler Gmail.");
    }
  }

  if (process.env.MICROSOFT_OUTLOOK_API_KEY) {
    try {
      const { fetchRecentOutlookInbox } = await import("./outlook.server");
      const o = await fetchRecentOutlookInbox(40);
      for (const e of o) {
        inbox.push({
          id: `outlook:${e.id}`,
          from: e.from,
          fromEmail: e.fromEmail,
          subject: e.subject,
          snippet: e.snippet,
          date: e.date,
          link: e.link,
        });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Falha ao ler Outlook.");
    }
  }

  if (inbox.length === 0) {
    return { emails: [], error: errors[0] ?? "Nenhuma caixa de e-mail conectada." };
  }

  try {
    const { classifyImportantEmails } = await import("./gmail.server");
    const flagged = await classifyImportantEmails(inbox as any);
    const byId = new Map(inbox.map((e) => [e.id, e]));
    const out: ImportantEmail[] = [];
    for (const f of flagged) {
      const e = byId.get(f.id);
      if (!e) continue;
      out.push({
        id: e.id,
        from: e.from,
        fromEmail: e.fromEmail,
        subject: e.subject,
        snippet: e.snippet,
        date: e.date,
        link: e.link,
        category: f.category,
        reason: f.reason,
      });
    }
    return { emails: out, error: errors[0] };
  } catch (err) {
    return {
      emails: [],
      error: err instanceof Error ? err.message : "Falha ao classificar e-mails.",
    };
  }
}

export const getImportantEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => loadImportantEmails());

export const getDailyBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { question?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("IA indisponível no momento.");

    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const [{ data: tasks }, { data: meetings }, mails] = await Promise.all([
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
      loadImportantEmails(),
    ]);

    const emailsForPrompt = mails.emails.map((e) => ({
      de: e.from,
      assunto: e.subject,
      categoria: e.category,
      motivo: e.reason,
    }));

    const prompt = [
      `Hoje é ${today}.`,
      `Tarefas em aberto (JSON): ${JSON.stringify(tasks ?? [])}`,
      `Reuniões dos próximos 7 dias (JSON): ${JSON.stringify(meetings ?? [])}`,
      `E-mails importantes já filtrados (JSON, ignore spam/propaganda): ${JSON.stringify(emailsForPrompt)}`,
      mails.error ? `Observação sobre e-mails: ${mails.error}` : "",
      data.question
        ? `Pergunta específica da usuária: ${data.question}`
        : "Gere o resumo do dia.",
    ].filter(Boolean).join("\n\n");

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
              "'## Hoje e amanhã' (lista), '## Reuniões' (lista), '## E-mails importantes' (lista curta com remetente e por que importa, ou 'Nenhum'), '## Sugestões' (2 a 4 ações práticas). " +
              "As empresas são Angi, Devore, Brand.Pe e Pessoal. Nunca cite propagandas, promoções ou newsletters. Não invente dados que não estejam no JSON.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Muitas solicitações. Tente de novo em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
    if (!res.ok) throw new Error(`Falha na IA (${res.status})`);

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return {
      text: json.choices?.[0]?.message?.content ?? "Sem resposta.",
      emails: mails.emails,
      emailsError: mails.error,
    };
  });

// ---------------------------------------------------------------------------
// aiAction: interpreta linguagem natural e cria/apaga tarefa ou reunião
// ---------------------------------------------------------------------------

type ActionResult = {
  intent: "add_task" | "add_meeting" | "delete" | "chat";
  reply: string;
  created?: { kind: "task" | "meeting"; title: string; when?: string };
  deleted?: { kind: "task" | "meeting"; title: string };
};

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

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
      "Empresas (source): 'angi', 'devore', 'bruna' (Brand.Pe), 'pessoal'.",
      "REGRA CRÍTICA DE CLASSIFICAÇÃO DE EMPRESA (siga nesta ordem):",
      "1. Se o usuário mencionar EXPLICITAMENTE 'angi' / 'na angi' / 'da angi' / 'pra angi' → source='angi'.",
      "2. Se mencionar 'devore' / 'na devore' → source='devore'.",
      "3. Se mencionar 'brand.pe' / 'brandpe' / 'bruna' / 'branding da bruna' → source='bruna'.",
      "4. Se mencionar 'pessoal' / 'minha vida' → source='pessoal'.",
      "⚠️ 'pessoal' pode aparecer no texto da tarefa (ex: 'branding pessoal Mariana') e NÃO como empresa. Só use source='pessoal' quando referir claramente à empresa.",
      "5. Se não houver menção clara de empresa, use 'pessoal'.",
      "Intents:",
      "- 'add_task' para tarefa (sem horário obrigatório).",
      "- 'add_meeting' para reunião/compromisso com horário.",
      "- 'delete' quando a usuária pede para APAGAR/REMOVER/EXCLUIR/CANCELAR algo (tarefa, reunião, compromisso, evento).",
      "- 'chat' para qualquer outra pergunta.",
      "Formato de resposta (JSON):",
      `{"intent":"add_task","reply":"...","task":{"title":"...","source":"pessoal","priority":"media","status":"todo","start_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD","notes":"opcional","location":"opcional"}}`,
      `{"intent":"add_meeting","reply":"...","meeting":{"title":"...","source":"pessoal","starts_at":"YYYY-MM-DDTHH:mm:00-03:00","ends_at":"YYYY-MM-DDTHH:mm:00-03:00 ou null","location":"opcional","people":"opcional","notes":"opcional","meeting_type":"Compromisso"}}`,
      `{"intent":"delete","reply":"...","target":{"kind":"task"|"meeting"|"auto","match":"palavras-chave do título","when":"YYYY-MM-DD opcional"}}`,
      `{"intent":"chat","reply":"resposta curta"}`,
      "Para delete: use kind='auto' se não estiver claro se é tarefa ou reunião; 'match' deve conter as palavras mais distintivas do título.",
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
          withMeetLink: true,
        });
        googleId = res.eventId ?? null;
        googleAccount = res.calendarId ?? null;
        externalUrl = res.meetLink ?? res.url ?? null;
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
        meeting_type: m.meeting_type ?? "Reunião",
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

    if (parsed.intent === "delete" && parsed.target?.match) {
      const target = parsed.target as { kind?: string; match: string; when?: string };
      const matchN = norm(target.match);
      const tables: ("tasks" | "meetings")[] =
        target.kind === "task"
          ? ["tasks"]
          : target.kind === "meeting"
            ? ["meetings"]
            : ["tasks", "meetings"];

      type Hit = {
        table: "tasks" | "meetings";
        id: string;
        title: string;
        google_event_id?: string | null;
        google_account?: string | null;
      };
      const hits: Hit[] = [];
      for (const table of tables) {
        const { data: rows } = await context.supabase
          .from(table)
          .select("id, title, google_event_id, google_account")
          .limit(500);
        for (const r of rows ?? []) {
          const t = norm((r as any).title ?? "");
          if (t.includes(matchN) || matchN.split(" ").every((w) => w && t.includes(w))) {
            hits.push({ table, ...(r as any) });
          }
        }
      }

      if (hits.length === 0) {
        return {
          intent: "chat",
          reply: `Não achei nada com "${target.match}". Tente com mais palavras do título.`,
        };
      }
      if (hits.length > 3) {
        return {
          intent: "chat",
          reply: `Encontrei ${hits.length} itens com "${target.match}". Seja mais específica — cite mais palavras do título.`,
        };
      }

      // Apaga do Google se vinculado, depois do banco.
      const { runDeleteGoogleEvent } = await import("./gcal-sync.server");
      const deleted: string[] = [];
      for (const h of hits) {
        if (h.google_event_id && h.google_account) {
          try {
            await runDeleteGoogleEvent(context.supabase, context.userId, {
              googleAccount: h.google_account,
              googleEventId: h.google_event_id,
            });
          } catch {
            // segue mesmo se Google falhar
          }
        }
        await context.supabase.from(h.table).delete().eq("id", h.id);
        deleted.push(h.title);
      }
      const first = hits[0];
      return {
        intent: "delete",
        reply:
          parsed.reply ??
          (deleted.length === 1
            ? `Apagado: "${deleted[0]}".`
            : `Apagados ${deleted.length} itens: ${deleted.join(", ")}.`),
        deleted: { kind: first.table === "tasks" ? "task" : "meeting", title: first.title },
      };
    }

    return { intent: "chat", reply: parsed.reply ?? "Ok." };
  });


