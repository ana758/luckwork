import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RegisterInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
  userAgent: z.string().optional(),
});

export const registerPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RegisterInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: context.userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          user_agent: data.userAgent ?? null,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
