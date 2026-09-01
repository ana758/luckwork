import { supabase } from "@/integrations/supabase/client";

/**
 * Em abas paralelas o token do Google pode estar sendo renovado bem na hora
 * do clique — a requisição sai sem usuário e o banco recusa com "row-level
 * security". Aqui a gente renova a sessão e tenta de novo, uma única vez.
 */
export async function withAuthRetry<T>(run: () => Promise<{ data: T | null; error: { message: string } | null }>) {
  let res = await run();
  if (res.error && /row-level security|JWT|not authenticated/i.test(res.error.message)) {
    await supabase.auth.refreshSession().catch(() => null);
    await supabase.auth.getSession().catch(() => null);
    res = await run();
  }
  if (res.error) {
    const msg = /row-level security/i.test(res.error.message)
      ? "Sua sessão expirou. Entre novamente para salvar."
      : res.error.message;
    throw new Error(msg);
  }
  return res.data as T;
}
