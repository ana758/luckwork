import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AccessEntry, Meeting, Task } from "./sources";

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Task[];
    },
  });
}

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*")
        .order("starts_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const signature = (m: { title: unknown; starts_at: string }) =>
        `${String(m.title)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim()}::${new Date(m.starts_at).toISOString()}`;
      const deletedGoogleSignatures = new Set(
        rows
          .filter((m) => m.hidden && m.google_event_id)
          .map((m) => signature(m)),
      );
      return rows.filter((m) => {
        if (m.hidden) return false;
        if (!m.google_event_id) return true;
        return !deletedGoogleSignatures.has(signature(m));
      }) as Meeting[];
    },
  });
}

export function useAccessEntries() {
  return useQuery({
    queryKey: ["access_entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_entries")
        .select("*")
        .order("label", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as AccessEntry[];
    },
  });
}

// Semana = domingo → sábado (padrão da LUCK).
export function startOfWeek(d = new Date()) {
  const date = new Date(d);
  date.setDate(date.getDate() - date.getDay()); // domingo = 0
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfWeek(d = new Date()) {
  const date = startOfWeek(d);
  date.setDate(date.getDate() + 6);
  date.setHours(23, 59, 59, 999);
  return date;
}
