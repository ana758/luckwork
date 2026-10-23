import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { meetingDateKey } from "./all-day";
import { isRemovedSource, type AccessEntry, type Meeting, type Task } from "./sources";

export async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  const out = ((data ?? []) as Task[]).filter((t) => !isRemovedSource(t.source));
  saveCache("tasks", out);
  return out;
}

const CACHE_PREFIX = "luck.cache.";
function saveCache(key: string, value: unknown) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota cheia: ignora */
  }
}

/** Mostra na hora os últimos dados salvos no aparelho enquanto busca os novos. */
export function seedQueryCache(qc: QueryClient) {
  for (const key of ["tasks", "meetings"]) {
    if (qc.getQueryData([key]) !== undefined) continue;
    try {
      const raw = window.localStorage.getItem(CACHE_PREFIX + key);
      if (raw) qc.setQueryData([key], JSON.parse(raw), { updatedAt: 0 });
    } catch {
      /* cache inválido */
    }
  }
}

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: fetchTasks,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}

export async function fetchMeetings(): Promise<Meeting[]> {
  // As duas buscas rodam juntas para abrir mais rápido.
  const [{ data, error }, { data: linked }] = await Promise.all([
    supabase.from("meetings").select("*").order("starts_at", { ascending: true }),
    supabase
      .from("tasks")
      .select("title, due_date, google_account, google_event_id, mirror_account, mirror_event_id"),
  ]);
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
  // Cópias que o Google devolve de uma tarefa (evento principal e cópia na agenda
  // pessoal) não são compromissos novos: a tarefa já é o registro verdadeiro.
  const taskEventPairs = new Set<string>();
  for (const t of linked ?? []) {
    if (t.google_account && t.google_event_id) taskEventPairs.add(`${t.google_account}::${t.google_event_id}`);
    if (t.mirror_account && t.mirror_event_id) taskEventPairs.add(`${t.mirror_account}::${t.mirror_event_id}`);
  }
  // Mesmo título no mesmo dia de uma tarefa: é cópia fantasma do Google.
  const normTitle = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const taskTitleDays = new Set<string>();
  for (const t of linked ?? []) {
    if (t.title && t.due_date) taskTitleDays.add(`${normTitle(t.title)}::${t.due_date}`);
  }
  const mirrorOfMeetings = new Set<string>();
  for (const m of rows) {
    const r = m as { mirror_account?: string | null; mirror_event_id?: string | null };
    if (r.mirror_account && r.mirror_event_id) mirrorOfMeetings.add(`${r.mirror_account}::${r.mirror_event_id}`);
  }
  const deletedGoogleSeries = new Set(
    rows.filter((m) => m.hidden && m.google_event_id).map(seriesKey).filter(Boolean),
  );
  const out = rows.filter((m) => {
    if (m.hidden) return false;
    if (isRemovedSource(m.source)) return false;
    if (!m.google_event_id) return true;
    if (taskTitleDays.has(`${normTitle(String(m.title))}::${meetingDateKey(m as { starts_at: string; ends_at?: string | null })}`))
      return false;
    const pair = `${m.google_account}::${m.google_event_id}`;
    if (taskEventPairs.has(pair) || mirrorOfMeetings.has(pair)) return false;
    return !deletedGoogleSignatures.has(signature(m)) && !deletedGoogleSeries.has(seriesKey(m));
  }) as Meeting[];
  saveCache("meetings", out);
  return out;
}

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: fetchMeetings,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
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
