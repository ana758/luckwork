import { useEffect, useState } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { enablePush, isPushEnabled, refreshPushSubscription, testPushHere } from "@/lib/push-client";

export function NotifPermissionButton() {
  const [state, setState] = useState<"unknown" | "off" | "on" | "unsupported">("unknown");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
        setState("unsupported");
        return;
      }
      const on = await isPushEnabled();
      if (on) await refreshPushSubscription().catch(() => false);
      setState(on ? "on" : "off");
    })();
  }, []);

  if (state === "unsupported" || state === "unknown") return null;

  if (state === "on") {
    return (
      <button
        type="button"
        disabled={testing}
        onClick={async () => {
          setTesting(true);
          toast.loading("Renovando e testando alertas...", { id: "push-test" });
          const r = await testPushHere();
          setTesting(false);
          if (r.ok) {
            toast.success("Alerta de teste enviado", {
              id: "push-test",
              description:
                "Bloqueie a tela: a notificação deve aparecer em alguns segundos. Se não vier, confira Ajustes > Notificações > LUCK.",
            });
          } else if (r.reason === "denied") {
            toast.error("Permissão negada", {
              id: "push-test",
              description: "Libere as notificações da LUCK nos ajustes do aparelho.",
            });
          } else {
            toast.error("Falha no envio", { id: "push-test", description: r.reason ?? `status ${r.status}` });
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-emerald-600"
        title="Toque para renovar e testar os alertas deste aparelho"
      >
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Testar alertas
      </button>
    );
  }


  return (
    <button
      onClick={async () => {
        const r = await enablePush();
        if (r.ok) {
          setState("on");
          toast.success("Alertas ativados", {
            description: "Você receberá notificações mesmo com o app fechado.",
          });
        } else if (r.reason === "denied") {
          toast.error("Permissão negada", {
            description: "Vá em Ajustes do navegador e libere notificações para a LUCK.",
          });
        } else {
          toast.error("Não foi possível ativar", { description: r.reason });
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      title="Ativar alertas — funcionam mesmo com o app fechado"
    >
      <BellRing className="h-3.5 w-3.5" />
      Ativar alertas
    </button>
  );
}
