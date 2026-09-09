import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AccessEntry, Meeting, Task } from "./sources";

export async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Task[];
}

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: fetchTasks,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: 45_000,
    placeholderData: (prev) => prev,
  });
}

export async function fetchMeetings(): Promise<Meeting[]> {
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
    rows.filter((m) => m.hidden && m.google_event_id).map((m) => signature(m)),
  );
  const seriesKey = (m: { google_account?: string | null; google_event_id?: string | null }) =>
    m.google_account && m.google_event_id
      ? `${m.google_account}::${m.google_event_id.replace(/_\d{8}T\d{6}Z$/, "")}`
      : null;
  const deletedGoogleSeries = new Set(
    rows.filter((m) => m.hidden && m.google_event_id).map(seriesKey).filter(Boolean),
  );
  return rows.filter((m) => {
    if (m.hidden) return false;
    if (!m.google_event_id) return true;
    return !deletedGoogleSignatures.has(signature(m)) && !deletedGoogleSeries.has(seriesKey(m));
  }) as Meeting[];
}

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: fetchMeetings,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: 45_000,
    placeholderData: (prev) => prev,
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
