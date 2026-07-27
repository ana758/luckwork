import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function pickPrimaryUser() {
  const sb = admin();
  const { data } = await sb
    .from("workspace_members")
    .select("user_id, email")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function logSync(source: string, status: string, extra: Record<string, unknown> = {}) {
  const sb = admin();
  await sb.from("sync_log").insert({ source, status, ...extra });
}

export const Route = createFileRoute("/api/public/hooks/sync-all")({
  server: {
    handlers: {
      POST: async () => {
        const userId = await pickPrimaryUser();
        if (!userId) return Response.json({ error: "no active user" }, { status: 404 });
        const sb = admin();
        const t0 = Date.now();
        const results: Record<string, unknown> = {};

        // Jira
        try {
          const { runJiraSync } = await import("@/lib/jira-sync.server");
          const r = await runJiraSync(sb, userId);
          results.jira = r;
          await logSync("jira", "ok", { imported: (r as any).imported ?? 0, pushed: (r as any).pushed ?? 0, duration_ms: Date.now() - t0 });
        } catch (e: any) {
          results.jira = { error: String(e?.message ?? e) };
          await logSync("jira", "error", { error: String(e?.message ?? e) });
        }

        // Notion
        try {
          const t = Date.now();
          const { runNotionSync } = await import("@/lib/notion-sync.server");
          const r = await runNotionSync(sb, userId);
          results.notion = r;
          await logSync("notion", "ok", { imported: (r as any).imported ?? 0, pushed: (r as any).pushed ?? 0, duration_ms: Date.now() - t });
        } catch (e: any) {
          results.notion = { error: String(e?.message ?? e) };
          await logSync("notion", "error", { error: String(e?.message ?? e) });
        }

        // Google Calendar
        try {
          const t = Date.now();
          const { runCalendarSync } = await import("@/lib/gcal-sync.server");
          const r = await runCalendarSync(sb, userId);
          results.gcal = r;
          await logSync("gcal", "ok", { imported: (r as any).imported ?? 0, duration_ms: Date.now() - t });
        } catch (e: any) {
          results.gcal = { error: String(e?.message ?? e) };
          await logSync("gcal", "error", { error: String(e?.message ?? e) });
        }

        return Response.json({ ok: true, results });
      },
    },
  },
});
