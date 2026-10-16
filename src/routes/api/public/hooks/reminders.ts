import { createFileRoute } from "@tanstack/react-router";
import { isAllDay } from "@/lib/all-day";
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

export const Route = createFileRoute("/api/public/hooks/reminders")({
  server: {
    handlers: {
      POST: async () => {
        const sb = admin();
        const now = new Date();
        const in66 = new Date(now.getTime() + 66 * 60 * 1000);
        // Lembretes insistentes: 1h, 30min, 15min e 5min antes.
        const CHECKPOINTS = [60, 30, 15, 5];
        const sent: string[] = [];

        // 1) Reuniões que começam nos próximos 36 min (janela do lembrete de 30 min)
        const { data: meetings } = await sb
          .from("meetings")
          .select("id, title, source, starts_at, ends_at, external_url, location")
          .neq("source", "devore")
          .gte("starts_at", now.toISOString())
          .lte("starts_at", in66.toISOString())
          .neq("hidden", true);

        // Dia inteiro não tem hora de início: não dispara lembrete de "começa em X min".
        const upcoming = (meetings ?? []).filter((m) => !isAllDay(m));
        // Cada reunião recebe um lembrete por checkpoint (1h, 30, 15 e 5 min).
        const candidates = upcoming
          .map((m) => {
            const minutes = Math.max(
              1,
              Math.round((new Date(m.starts_at).getTime() - now.getTime()) / 60000),
            );
            const cp = CHECKPOINTS.find((c) => minutes <= c) ?? null;
            return cp === null ? null : { m, minutes, cp };
          })
          .filter((x): x is { m: (typeof upcoming)[number]; minutes: number; cp: number } => x !== null);

        const seen = new Set<string>();
        const allTags = candidates.map((c) => `meeting-${c.cp}-${c.m.id}`);
        if (allTags.length > 0) {
          const { data: already } = await sb.from("pending_pushes").select("tag").in("tag", allTags);
          for (const r of already ?? []) if (r.tag) seen.add(r.tag);
        }

        for (const { m, minutes, cp } of candidates) {
          const tag = `meeting-${cp}-${m.id}`;
          if (seen.has(tag)) continue;
          const label = SOURCE_LABEL[m.source] || m.source;
          const when = new Date(m.starts_at);
          const hh = when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

          // Link da chamada: usa o salvo; se faltar, procura nos e-mails conectados.
          let link = m.external_url;
          if (!link) {
            try {
              const { findMeetingLink } = await import("@/lib/gmail.server");
              link = await findMeetingLink(m.title);
              if (link) await sb.from("meetings").update({ external_url: link }).eq("id", m.id);

            } catch {
              link = null;
            }
          }

          await notifyAll({
            title: `⏰ Reunião em ${minutes} min — ${label}`,
            body: `${hh} · ${m.title}${link ? " · toque para entrar e gravar" : m.location ? ` · ${m.location}` : ""}`,
            url: link ? `/reunioes?open=${m.id}` : "/reunioes",
            tag,
          });
          sent.push(`meeting:${m.id}`);
        }


        // 1b) Tarefas com horário marcado — um aviso 1h antes
        const todayKey = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const { data: timedTasks } = await sb
          .from("tasks")
          .select("id, title, source, due_date, due_time")
          .neq("source", "devore")
          .eq("due_date", todayKey)
          .neq("status", "done")
          .not("due_time", "is", null);

        for (const t of timedTasks ?? []) {
          const start = new Date(`${t.due_date}T${(t.due_time as string).slice(0, 5)}:00-03:00`);
          const minutes = Math.round((start.getTime() - now.getTime()) / 60000);
          if (minutes <= 0 || minutes > 60) continue;
          const tag = `task-60-${t.id}`;
          const { data: already } = await sb
            .from("pending_pushes")
            .select("tag")
            .eq("tag", tag)
            .limit(1);
          if ((already ?? []).length > 0) continue;
          await notifyAll({
            title: `⏰ Em ${minutes} min — ${SOURCE_LABEL[t.source] || t.source}`,
            body: `${(t.due_time as string).slice(0, 5)} · ${t.title}`,
            url: "/tarefas",
            tag,
          });
          sent.push(`task:${t.id}`);
        }

        // 2) Tarefas atrasadas — vencidas e sem movimentação de board (7 dias de tolerância
        // para o que já saiu de "a fazer") — resumo agregado por empresa
        const today = now.toISOString().slice(0, 10);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
        const { data: openPastDue } = await sb
          .from("tasks")
          .select("id, title, source, due_date, status, status_changed_at, updated_at")
          .neq("source", "devore")
          .lt("due_date", today)
          .neq("status", "done");
        const overdue = (openPastDue ?? []).filter(
          (t) => t.status === "todo" || (t.status_changed_at ?? t.updated_at) < sevenDaysAgo,
        );




        if ((overdue ?? []).length > 0) {
          // Uma vez por dia apenas
          const overdueTag = `overdue-summary-${today.replace(/-/g, "")}`;
          const { data: sentToday } = await sb
            .from("pending_pushes")
            .select("tag")
            .eq("tag", overdueTag)
            .limit(1);
          if ((sentToday ?? []).length === 0) {
            const bySource: Record<string, number> = {};
            for (const t of overdue ?? []) bySource[t.source] = (bySource[t.source] ?? 0) + 1;
            const parts = Object.entries(bySource)
              .map(([s, n]) => `${SOURCE_LABEL[s] || s}: ${n}`)
              .join(" · ");
            await notifyAll({
              title: `📌 Você tem ${overdue!.length} tarefa(s) atrasada(s)`,
              body: parts,
              url: "/tarefas",
              tag: overdueTag,
            });
            sent.push(`overdue:${overdue!.length}`);
          }
        }

        return Response.json({ ok: true, sent });
      },
    },
  },
});
