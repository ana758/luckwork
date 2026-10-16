import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Estado real das integrações de e-mail (não só o cadastro): quais contas estão
 * conectadas, quais precisam reconectar e quais deram erro. Nunca devolve chaves,
 * senhas ou tokens.
 */
export const getMailIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { gmailConnectionStatus } = await import("./gmail.server");
    const { outlookConnectionStatus } = await import("./outlook.server");
    const [gmail, outlook] = await Promise.all([
      gmailConnectionStatus().catch(() => []),
      outlookConnectionStatus().catch(() => ({ configured: false as const })),
    ]);
    return { gmail, outlook };
  });
