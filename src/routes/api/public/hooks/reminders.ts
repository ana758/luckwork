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

export const Route = createFileRoute("/api/public/hooks/reminders")({
  server: {
    handlers: {
      POST: async () => {
        const sb = admin();
        const now = new Date();
        const in36 = new Date(now.getTime() + 36 * 60 * 1000);
        const sent: string[] = [];

        // 1) Reuniões que começam nos próximos 36 min (janela do lembrete de 30 min)
        const { data: meetings } = await sb
          .from("meetings")
          .select("id, title, source, starts_at, external_url, location")
          .gte("starts_at", now.toISOString())
          .lte("starts_at", in36.toISOString())
          .neq("hidden", true);

        const upcoming = meetings ?? [];
        // Dedupe: nunca repete o lembrete da mesma reunião
        const tags30 = upcoming.map((m) => `meeting-30-${m.id}`);
        const seen = new Set<string>();
        if (tags30.length > 0) {
          const { data: already } = await sb.from("pending_pushes").select("tag").in("tag", tags30);
          for (const r of already ?? []) if (r.tag) seen.add(r.tag);
        }

        for (const m of upcoming) {
          const tag = `meeting-30-${m.id}`;
          if (seen.has(tag)) continue;
          const minutes = Math.max(
            1,
            Math.round((new Date(m.starts_at).getTime() - now.getTime()) / 60000),
          );
          const label = SOURCE_LABEL[m.source] || m.source;
          const when = new Date(m.starts_at);
          const hh = when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

          // Link da chamada: usa o salvo; se faltar, procura nos e-mails conectados.
          let link = m.external_url;
          if (!link && process.env.GOOGLE_MAIL_API_KEY) {
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


        // 2) Tarefas atrasadas — vencidas e sem movimentação de board (7 dias de tolerância
        // para o que já saiu de "a fazer") — resumo agregado por empresa
        const today = now.toISOString().slice(0, 10);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
        const { data: openPastDue } = await sb
          .from("tasks")
          .select("id, title, source, due_date, status, status_changed_at, updated_at")
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
