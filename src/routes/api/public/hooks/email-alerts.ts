import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { notifyAll } from "@/lib/notify.server";
import { fetchRecentInbox, classifyImportantEmails } from "@/lib/gmail.server";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/**
 * Alerta push de e-mails importantes.
 * Roda por cron; só notifica mensagens não lidas, classificadas como importantes
 * pela IA, e nunca repete o mesmo e-mail (dedupe pela tag mail-<id>).
 */
export const Route = createFileRoute("/api/public/hooks/email-alerts")({
  server: {
    handlers: {
      POST: async () => {
        const sb = admin();

        let inbox;
        try {
          inbox = await fetchRecentInbox(30);
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 200 });
        }

        const unread = inbox.filter((m) => m.unread);
        if (unread.length === 0) return Response.json({ ok: true, sent: [] });

        // Já notificados?
        const tags = unread.map((m) => `mail-${m.id}`);
        const { data: already } = await sb.from("pending_pushes").select("tag").in("tag", tags);
        const seen = new Set((already ?? []).map((r) => r.tag));
        const fresh = unread.filter((m) => !seen.has(`mail-${m.id}`));
        if (fresh.length === 0) return Response.json({ ok: true, sent: [] });

        let important: { id: string; reason: string; category: string }[] = [];
        try {
          important = await classifyImportantEmails(fresh);
        } catch {
          important = [];
        }
        const importantIds = new Set(important.map((i) => i.id));
        const picks = fresh.filter((m) => importantIds.has(m.id)).slice(0, 5);

        const sent: string[] = [];
        for (const m of picks) {
          const reason = important.find((i) => i.id === m.id)?.category;
          await notifyAll({
            title: `📧 E-mail importante — ${m.from}`.slice(0, 90),
            body: `${m.subject}${reason ? ` · ${reason}` : ""}`,
            url: m.link,
            tag: `mail-${m.id}`,
          });
          sent.push(m.id);
        }

        return Response.json({ ok: true, sent, checked: fresh.length });
      },
    },
  },
});
