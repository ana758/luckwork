/**
 * Compromissos de DIA INTEIRO.
 *
 * O Google Agenda manda eventos de dia inteiro como uma data (sem hora). A
 * tabela `meetings` só guarda timestamptz, então esses eventos precisam de uma
 * convenção. Antes eram gravados como 00:00 UTC, que no Brasil (UTC-3) aparece
 * como 21:00 do dia anterior. Agora são gravados de 00:00 a 23:59 no horário de
 * Brasília (UTC-3, sem horário de verão desde 2019) e reconhecidos por estas
 * funções. O formato antigo (00:00 UTC) continua reconhecido, para os registros
 * que ainda não foram regravados pela sincronização.
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const MIN = 60 * 1000;

type Span = { starts_at: string; ends_at?: string | null };

function utcMinuteOfDay(ms: number) {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

/** Formato novo: 00:00 → 23:59 em Brasília (03:00Z → 02:59Z). */
function isBrtAllDay(s: Span) {
  const start = new Date(s.starts_at).getTime();
  if (utcMinuteOfDay(start) !== 180) return false;
  if (!s.ends_at) return false;
  const end = new Date(s.ends_at).getTime();
  return utcMinuteOfDay(end) === 179 && end > start;
}

/** Formato antigo: 00:00 UTC (e fim às 23:59 UTC, quando há fim). */
function isLegacyUtcAllDay(s: Span) {
  const start = new Date(s.starts_at).getTime();
  if (utcMinuteOfDay(start) !== 0) return false;
  if (!s.ends_at) return true;
  const end = new Date(s.ends_at).getTime();
  return utcMinuteOfDay(end) === 23 * 60 + 59;
}

export function isAllDay(s: Span) {
  return isBrtAllDay(s) || isLegacyUtcAllDay(s);
}

/** Dia (AAAA-MM-DD) do compromisso, sem deslocar eventos de dia inteiro. */
export function meetingDateKey(s: Span) {
  const start = new Date(s.starts_at).getTime();
  if (isBrtAllDay(s)) return new Date(start - BRT_OFFSET_MS).toISOString().slice(0, 10);
  if (isLegacyUtcAllDay(s)) return new Date(start).toISOString().slice(0, 10);
  // Compromisso com hora: dia local no horário de Brasília.
  return new Date(start - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:MM" em Brasília, ou null para dia inteiro. */
export function meetingTimeLabel(s: Span) {
  if (isAllDay(s)) return null;
  return new Date(s.starts_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/** Início/fim de dia inteiro no formato novo, a partir de AAAA-MM-DD. */
export function allDayRange(dateKey: string) {
  return {
    starts_at: new Date(`${dateKey}T00:00:00-03:00`).toISOString(),
    ends_at: new Date(`${dateKey}T23:59:00-03:00`).toISOString(),
  };
}

/** Hoje (ou qualquer data) como AAAA-MM-DD no horário de Brasília. */
export function localDateKey(d: Date) {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}
