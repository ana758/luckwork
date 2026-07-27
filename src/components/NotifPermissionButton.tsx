import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { ensureNotifPermission } from "@/lib/desktop-notify";

export function NotifPermissionButton() {
  const [status, setStatus] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const id = window.setInterval(() => setStatus(Notification.permission), 2000);
    return () => window.clearInterval(id);
  }, []);

  if (status === "unsupported") return null;
  if (status === "granted") return null;

  return (
    <button
      onClick={async () => {
        const ok = await ensureNotifPermission();
        setStatus(ok ? "granted" : Notification.permission);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      title="Ativar alertas do sistema"
    >
      <BellRing className="h-3.5 w-3.5" />
      Ativar alertas
    </button>
  );
}
