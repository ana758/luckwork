import { useEffect, useRef, useState } from "react";
import { Bell, Check, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { playNotificationSound, primeNotificationSound } from "@/lib/notify-sound";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: items = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, created_at, read_at")
        .order("created_at", { ascending: false })
        .limit(30);
      return (data ?? []) as Notification[];
    },
    refetchInterval: 30_000,
  });

  const unread = items.filter((n) => !n.read_at).length;

  // Som + vibração quando chega notificação nova com o app aberto.
  const prevUnread = useRef<number | null>(null);
  useEffect(() => {
    primeNotificationSound();
  }, []);
  useEffect(() => {
    if (prevUnread.current !== null && unread > prevUnread.current) {
      playNotificationSound();
    }
    prevUnread.current = unread;
  }, [unread]);



  // App icon badge on installed PWA (iOS 16.4+ / Android Chrome).
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unread > 0) nav.setAppBadge?.(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
    // Tab title indicator
    const base = "LUCK";
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [unread]);

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = items.filter((n) => !n.read_at).map((n) => n.id);
      if (!ids.length) return;
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").delete().eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Notificações"
          className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border bg-card hover:bg-accent ${
            unread > 0 ? "border-destructive/60 text-destructive animate-pulse" : ""
          }`}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          <button
            onClick={() => markAllRead.mutate()}
            disabled={!unread}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Marcar todas como lidas
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              Sem notificações por enquanto.
            </div>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={`group flex gap-2 border-b px-3 py-2 text-sm ${
                  n.read_at ? "opacity-60" : "bg-accent/30"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{n.title}</p>
                  {n.body && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {!n.read_at && (
                    <button
                      onClick={() => markOne.mutate(n.id)}
                      aria-label="Marcar como lida"
                      className="rounded p-1 hover:bg-accent"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => remove.mutate(n.id)}
                    aria-label="Remover"
                    className="rounded p-1 hover:bg-accent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
