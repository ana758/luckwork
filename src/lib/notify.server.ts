import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendPush } from "./webpush.server";


function admin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** Queue a notification and wake all push subscribers. */
export async function notifyAll(params: {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}): Promise<{ queued: number; woke: number; failed: number }> {
  const sb = admin();
  const { data: inserted, error } = await sb
    .from("pending_pushes")
    .insert({
      title: params.title,
      body: params.body ?? null,
      url: params.url ?? "/",
      tag: params.tag ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: subs } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth");
  let woke = 0;
  let failed = 0;
  for (const s of subs ?? []) {
    try {
      const status = await sendWakeupPush(s);
      if (status >= 200 && status < 300) {
        woke++;
        await sb
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("endpoint", s.endpoint);
      } else if (status === 404 || status === 410) {
        // Gone — clean up
        await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return { queued: inserted ? 1 : 0, woke, failed };
}
