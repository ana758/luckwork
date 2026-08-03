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

/** Envia um push de teste apenas para o aparelho atual e devolve o status HTTP do serviço de push. */
export const sendTestPushToDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ endpoint: z.string().url() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("endpoint", data.endpoint)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Este aparelho ainda não está registrado.");

    const { sendPush } = await import("./webpush.server");
    const status = await sendPush(sub, {
      title: "🍀 Teste da LUCK",
      body: "Se você viu isso, os alertas deste aparelho estão funcionando.",
      url: "/",
      tag: `test-${Date.now()}`,
    });
    return { status, ok: status >= 200 && status < 300 };
  });

/** Remove assinaturas antigas deste mesmo aparelho (mesmo user agent), mantendo a atual. */
export const cleanupOldSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ endpoint: z.string().url(), userAgent: z.string() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId)
      .eq("user_agent", data.userAgent)
      .neq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
