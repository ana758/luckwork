import { createFileRoute } from "@tanstack/react-router";
import { notifyAll } from "@/lib/notify.server";

/** Manual/cron-triggered test alert. */
export const Route = createFileRoute("/api/public/hooks/test-push")({
  server: {
    handlers: {
      POST: async () => {
        const now = new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        });
        const res = await notifyAll({
          title: "🍀 Teste de alerta LUCK",
          body: `Se você está vendo isso na tela bloqueada, está funcionando (${now}).`,
          url: "/",
          tag: `test-${Date.now()}`,
        });
        return Response.json({ ok: true, ...res });
      },
    },
  },
});
