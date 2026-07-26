import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertMember(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_active_member", { _user_id: userId });
  if (!data) throw new Error("Sem permissão");
}

export const saveAccessPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; password: string }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, context.userId);
    const { encryptSecret } = await import("./vault.server");
    const ciphertext = data.password ? encryptSecret(data.password) : null;
    const { error } = await context.supabase
      .from("access_entries")
      .update({ password_ciphertext: ciphertext })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revealAccessPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("access_entries")
      .select("password_ciphertext")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.password_ciphertext) return { password: "" };
    const { decryptSecret } = await import("./vault.server");
    return { password: decryptSecret(row.password_ciphertext) };
  });
