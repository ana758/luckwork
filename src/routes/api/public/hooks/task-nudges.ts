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

const PRIORITY_WEIGHT: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

/**
 * "Não se esqueça da tarefa X da empresa Y".
 * Dispara lembretes individuais de tarefas ainda em "a fazer" (todo).
 * Só considera janela útil (07-21h São Paulo) e evita repetir a mesma tarefa no mesmo dia.
 */
export const Route = createFileRoute("/api/public/hooks/task-nudges")({
  server: {
    handlers: {
      POST: async () => {
        const sb = admin();

        // Janela útil em SP (UTC-3): entre 07 e 21h locais.
        const nowUtc = new Date();
        const hourSp = (nowUtc.getUTCHours() - 3 + 24) % 24;
        if (hourSp < 7 || hourSp >= 21) {
          return Response.json({ ok: true, skipped: "fora da janela útil", hourSp });
        }

        const today = nowUtc.toISOString().slice(0, 10);

        // Candidatas: status = 'todo'
        const { data: candidates } = await sb
          .from("tasks")
          .select("id, title, source, due_date, priority, created_at")
          .neq("source", "devore")
          .eq("status", "todo")
          .limit(200);

        if (!candidates || candidates.length === 0) {
          return Response.json({ ok: true, sent: [] });
        }

        // Já lembradas hoje: procura tags nudge-<id>-<YYYYMMDD>
        const dayTag = today.replace(/-/g, "");
        const ids = candidates.map((t) => t.id);
        const { data: alreadySent } = await sb
          .from("pending_pushes")
          .select("tag")
          .in("tag", ids.map((id) => `nudge-${id}-${dayTag}`));
        const skip = new Set((alreadySent ?? []).map((r) => r.tag));

        // Ordena: atrasadas > prioridade alta > vence hoje > mais antigas
        const scored = candidates
          .filter((t) => !skip.has(`nudge-${t.id}-${dayTag}`))
          .map((t) => {
            const overdue = t.due_date && t.due_date < today ? 0 : 1;
            const dueToday = t.due_date === today ? 0 : 1;
            const prio = PRIORITY_WEIGHT[t.priority ?? "media"] ?? 1;
            return { t, key: [overdue, prio, dueToday, t.created_at] as const };
          })
          .sort((a, b) => {
            for (let i = 0; i < 3; i++) {
              const av = a.key[i] as number;
              const bv = b.key[i] as number;
              if (av !== bv) return av - bv;
            }
            return String(a.key[3]).localeCompare(String(b.key[3]));
          });

        // Envia no máximo 2 lembretes por rodada
        const picks = scored.slice(0, 2);
        const sent: string[] = [];

        for (const { t } of picks) {
          const label = SOURCE_LABEL[t.source] || t.source;
          const overdue = t.due_date && t.due_date < today;
          const prefix = overdue ? "⏰ Atrasada" : "🔔 Não esqueça";
          const body = overdue
            ? `${t.title} — ${label} (venceu ${t.due_date})`
            : `${t.title} — ${label}${t.due_date ? ` (vence ${t.due_date})` : ""}`;

          await notifyAll({
            title: `${prefix} · ${label}`,
            body,
            url: "/tarefas",
            tag: `nudge-${t.id}-${dayTag}`,
          });
          sent.push(t.id);
        }

        return Response.json({ ok: true, sent, considered: candidates.length });
      },
    },
  },
});
