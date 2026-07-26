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
        .eq("hidden", false)
        .order("starts_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Meeting[];
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

export function startOfWeek(d = new Date()) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // segunda = 0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfWeek(d = new Date()) {
  const date = startOfWeek(d);
  date.setDate(date.getDate() + 6);
  date.setHours(23, 59, 59, 999);
  return date;
}
