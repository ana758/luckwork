import { useEffect, useState } from "react";
import { BellRing, BellOff, Check } from "lucide-react";
import { toast } from "sonner";
import { enablePush, isPushEnabled } from "@/lib/push-client";

export function NotifPermissionButton() {
  const [state, setState] = useState<"unknown" | "off" | "on" | "unsupported">("unknown");

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
        setState("unsupported");
        return;
      }
      const on = await isPushEnabled();
      setState(on ? "on" : "off");
    })();
  }, []);

  if (state === "unsupported" || state === "unknown") return null;

  if (state === "on") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-emerald-600"
        title="Notificações ativadas — chegam mesmo com o app fechado"
      >
        <Check className="h-3.5 w-3.5" />
        Alertas ativos
      </span>
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
