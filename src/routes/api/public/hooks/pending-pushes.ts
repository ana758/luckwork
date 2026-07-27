import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Called by the service worker on 'push' event. Returns undelivered items and marks them delivered. */
export const Route = createFileRoute("/api/public/hooks/pending-pushes")({
  server: {
    handlers: {
      GET: async () => {
        const sb = admin();
        const { data } = await sb
          .from("pending_pushes")
          .select("id, title, body, url, tag")
          .is("delivered_at", null)
          .order("created_at", { ascending: true })
          .limit(20);

        const items = data ?? [];
        if (items.length > 0) {
          await sb
            .from("pending_pushes")
            .update({ delivered_at: new Date().toISOString() })
            .in("id", items.map((i) => i.id));
        }
        return Response.json(
          { items },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
