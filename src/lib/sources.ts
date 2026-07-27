export type SourceKey = "angi" | "devore" | "bruna" | "pessoal";
export type TaskStatus = "todo" | "doing" | "onhold" | "done";
export type TaskPriority = "alta" | "media" | "baixa";
export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export const SOURCES: { key: SourceKey; label: string }[] = [
  { key: "angi", label: "Angi" },
  { key: "devore", label: "Devore" },
  { key: "bruna", label: "Brand.Pe" },
  { key: "pessoal", label: "Pessoal" },
];

export const SOURCE_LABEL: Record<SourceKey, string> = {
  angi: "Angi",
  devore: "Devore",
  bruna: "Brand.Pe",
  pessoal: "Pessoal",
};

/** Tailwind classes per source — colours come from semantic tokens only. */
export const SOURCE_DOT: Record<SourceKey, string> = {
  angi: "bg-angi",
  devore: "bg-devore",
  bruna: "bg-bruna",
  pessoal: "bg-pessoal",
};

export const SOURCE_CHIP: Record<SourceKey, string> = {
  angi: "bg-angi-soft text-angi",
  devore: "bg-devore-soft text-devore",
  bruna: "bg-bruna-soft text-bruna",
  pessoal: "bg-pessoal-soft text-pessoal",
};

export const SOURCE_BORDER: Record<SourceKey, string> = {
  angi: "border-l-angi",
  devore: "border-l-devore",
  bruna: "border-l-bruna",
  pessoal: "border-l-pessoal",
};

/** Full-card tint: soft brand background + brand border. */
export const SOURCE_TINT: Record<SourceKey, string> = {
  angi: "bg-angi-soft border-angi/30",
  devore: "bg-devore-soft border-devore/30",
  bruna: "bg-bruna-soft border-bruna/30",
  pessoal: "bg-pessoal-soft border-pessoal/30",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  onhold: "On hold",
  done: "Concluída",
};

export const STATUS_ORDER: TaskStatus[] = ["todo", "doing", "onhold", "done"];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: "Sem recorrência",
  daily: "Diária",
  weekly: "Semanal",
  monthly: "Mensal",
};

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  source: SourceKey;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  recurrence: Recurrence;
  external_system: string | null;
  external_id?: string | null;
  external_url: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Meeting = {
  id: string;
  title: string;
  source: SourceKey;
  starts_at: string;
  ends_at: string | null;
  meeting_type: string | null;
  people: string | null;
  location?: string | null;
  notes: string | null;
  external_url: string | null;
  status?: TaskStatus;
  completed_at?: string | null;
};

export type AccessEntry = {
  id: string;
  source: SourceKey;
  label: string;
  url: string | null;
  login: string | null;
  password_ciphertext: string | null;
  is_connected: boolean;
};

export function isOverdue(task: Task) {
  if (!task.due_date) return false;
  // Só conta como atrasada se ainda estiver "a fazer" (todo).
  // Em andamento, em espera ou concluída não contam.
  if (task.status !== "todo") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${task.due_date}T00:00:00`) < today;
}

