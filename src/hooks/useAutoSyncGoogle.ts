import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { syncGoogleCalendar } from "@/lib/gcal.functions";

const INTERVAL_MS = 3 * 60 * 1000; // 3 min
let lastRun = 0;
let inFlight: Promise<unknown> | null = null;

async function runOnce(qc: ReturnType<typeof useQueryClient>) {
  if (inFlight) return inFlight;
  if (Date.now() - lastRun < 30_000) return; // cooldown curto
  inFlight = (async () => {
    try {
      await syncGoogleCalendar();
      lastRun = Date.now();
      await qc.invalidateQueries({ queryKey: ["meetings"] });
    } catch {
      // silencioso — botão manual mostra o erro real
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Sincroniza Google Agenda ao montar e a cada 3 min enquanto a aba estiver ativa. */
export function useAutoSyncGoogle() {
  const qc = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    runOnce(qc);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") runOnce(qc);
    }, INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") runOnce(qc);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [qc]);
}
