import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncGoogleCalendar } from "@/lib/gcal.functions";

export function SyncGoogleButton() {
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  async function run() {
    setLoading(true);
    try {
      const res = await syncGoogleCalendar();
      const detail = res.accounts.map((a) => `${a.email} (${a.count})`).join(" · ");
      toast.success(`Agendas sincronizadas: ${res.imported} eventos`, { description: detail });
      await qc.invalidateQueries({ queryKey: ["meetings"] });
    } catch (e) {
      toast.error("Não consegui sincronizar", {
        description: e instanceof Error ? e.message : "Erro desconhecido",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Sincronizando…" : "Sincronizar Google"}
    </button>
  );
}
