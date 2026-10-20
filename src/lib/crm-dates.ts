/** Datas que viram compromisso no LUCK: início e, se houver, prazo final. Nunca a data do update. */
export type CrmInteractionDates = {
  when?: string | null;
  start?: string | null;
  start_date?: string | null;
  inicio?: string | null;
  due?: string | null;
  due_date?: string | null;
  deadline?: string | null;
  prazo_final?: string | null;
};

function day(value?: string | null): string | null {
  if (!value) return null;
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function crmScheduleDates(i: CrmInteractionDates): { start: string | null; due: string | null } {
  // O campo legado `when` mistura início e update; não é seguro agendar por ele.
  const start = day(i.start_date ?? i.start ?? i.inicio);
  const dueRaw = day(i.due_date ?? i.due ?? i.deadline ?? i.prazo_final);
  return { start, due: dueRaw && dueRaw !== start ? dueRaw : null };
}