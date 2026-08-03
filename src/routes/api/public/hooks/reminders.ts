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
          await notifyAll({
            title: `⏰ Reunião em ${minutes} min — ${label}`,
            body: `${hh} · ${m.title}${m.location ? ` · ${m.location}` : ""}`,
            url: m.external_url || "/reunioes",
            tag,
          });
          sent.push(`meeting:${m.id}`);
        }

        // 2) Tarefas atrasadas (due_date antes de hoje, ainda em aberto) — resumo agregado por empresa
        const today = now.toISOString().slice(0, 10);
        const { data: overdue } = await sb
          .from("tasks")
          .select("id, title, source, due_date, status")
          .lt("due_date", today)
          .eq("status", "todo");


        if ((overdue ?? []).length > 0) {
          const bySource: Record<string, number> = {};
          for (const t of overdue ?? []) bySource[t.source] = (bySource[t.source] ?? 0) + 1;
          const parts = Object.entries(bySource)
            .map(([s, n]) => `${SOURCE_LABEL[s] || s}: ${n}`)
            .join(" · ");
          await notifyAll({
            title: `📌 Você tem ${overdue!.length} tarefa(s) atrasada(s)`,
            body: parts,
            url: "/tarefas",
            tag: "overdue-summary",
          });
          sent.push(`overdue:${overdue!.length}`);
        }

        return Response.json({ ok: true, sent });
      },
    },
  },
});
