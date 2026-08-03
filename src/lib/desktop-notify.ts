/**
 * Notificações nativas do sistema (Windows/macOS/Android/iOS PWA).
 * Funciona enquanto o app está aberto (ou instalado em segundo plano em
 * Android/desktop). No iPhone só dispara com a LUCK instalada na tela de início.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SOURCE_LABEL } from "@/lib/sources";
import { playNotificationSound } from "@/lib/notify-sound";


const FIRED_KEY = "luck.fired.v1";
const REMINDER_KEY = "luck.reminded.v1";

function firedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveFired(s: Set<string>) {
  const arr = Array.from(s).slice(-500);
  localStorage.setItem(FIRED_KEY, JSON.stringify(arr));
}

export async function ensureNotifPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const r = await Notification.requestPermission();
  return r === "granted";
}

function fire(title: string, body?: string, tag?: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      silent: false,
    } as NotificationOptions);
    playNotificationSound();
  } catch {
    /* iOS pré-16.4 dá throw — ignora */
  }
}


export function useDesktopReminders() {
  const enabled =
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted";

  // reuniões próximas
  const meetings = useQuery({
    queryKey: ["reminders", "meetings"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = new Date();
      const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const { data } = await supabase
        .from("meetings")
        .select("id, title, starts_at, source, external_url")
        .gte("starts_at", now.toISOString())
        .lte("starts_at", in2h.toISOString())
        .eq("hidden", false);
      return data ?? [];
    },
  });

  // tarefas em aberto (ping periódico)
  const tasks = useQuery({
    queryKey: ["reminders", "tasks"],
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id, title, source, status, due_date")
        .neq("status", "done");
      return data ?? [];
    },
  });

  const lastPing = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    const fired = firedSet();

    // Reunião: 30 min antes (janela 25-31 min)
    for (const m of meetings.data ?? []) {
      const diff = new Date(m.starts_at).getTime() - Date.now();
      const min = diff / 60_000;
      const tag = `meet-30-${m.id}`;
      if (min <= 31 && min >= 25 && !fired.has(tag)) {
        fire(
          `Reunião em ${Math.round(min)} min · ${SOURCE_LABEL[m.source as keyof typeof SOURCE_LABEL] ?? ""}`,
          m.title + (m.external_url ? `\n${m.external_url}` : ""),
          tag,
        );
        fired.add(tag);
      }
      // Alerta na hora
      const tagNow = `meet-now-${m.id}`;
      if (min <= 2 && min >= -1 && !fired.has(tagNow)) {
        fire("Sua reunião está começando", m.title, tagNow);
        fired.add(tagNow);
      }
    }
    saveFired(fired);
  }, [meetings.data, enabled]);

  // Lembretes recorrentes de tarefas pendentes (a cada ~2h)
  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const last = Number(localStorage.getItem(REMINDER_KEY) || 0);
    if (now - last < 2 * 60 * 60_000) return;
    const list = tasks.data ?? [];
    if (list.length === 0) return;

    // pega até 3 mais críticas (com due_date passado primeiro, depois hoje)
    const today = new Date().toISOString().slice(0, 10);
    const critical = list
      .filter((t) => t.due_date && t.due_date <= today)
      .slice(0, 3);
    const pick = critical.length ? critical : list.slice(0, 1);
    for (const t of pick) {
      const label = SOURCE_LABEL[t.source as keyof typeof SOURCE_LABEL] ?? "";
      fire(`Não esqueça: ${t.title}`, `${label}${t.due_date ? " · vence " + t.due_date : ""}`, `rem-${t.id}-${now}`);
    }
    localStorage.setItem(REMINDER_KEY, String(now));
    lastPing.current = now;
  }, [tasks.data, enabled]);
}
