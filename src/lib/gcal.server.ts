/**
 * Server-only Google Calendar access through the Lovable connector gateway.
 * Never import this from client code.
 */
import type { SourceKey } from "./sources";

const GATEWAY = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

/** Each linked Google account, with the brand it maps to by default. */
export type GoogleAccount = {
  /** env var holding the connection key */
  envVar: string;
  defaultSource: SourceKey;
};

export const GOOGLE_ACCOUNTS: GoogleAccount[] = [
  { envVar: "GOOGLE_CALENDAR_API_KEY", defaultSource: "devore" },
  { envVar: "GOOGLE_CALENDAR_API_KEY_1", defaultSource: "pessoal" },
  { envVar: "GOOGLE_CALENDAR_API_KEY_2", defaultSource: "angi" },
];

function headers(connectionKey: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY não está configurada.");
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Connection-Api-Key": connectionKey,
    "Content-Type": "application/json",
  };
}

async function gcal(connectionKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, { ...init, headers: headers(connectionKey) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Agenda falhou [${res.status}]: ${body.slice(0, 400)}`);
  }
  return res.json();
}

export type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string }[];
  organizer?: { email?: string; displayName?: string };
  hangoutLink?: string;
};

export type GCalendar = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
};

/** All calendars visible to the account (includes shared/subscribed ones). */
export async function listCalendars(connectionKey: string): Promise<GCalendar[]> {
  const data = await gcal(connectionKey, "/users/me/calendarList?maxResults=250");
  return (data.items ?? []) as GCalendar[];
}

/** Primary calendar id (the account's own e-mail). */
export async function primaryCalendarId(connectionKey: string): Promise<string> {
  const items = await listCalendars(connectionKey);
  const primary = items.find((i) => i.primary);
  return primary?.id ?? "primary";
}

/** Events in a window on a specific calendar. */
export async function listEvents(
  connectionKey: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GEvent[]> {
  const qs = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await gcal(
    connectionKey,
    `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
  );
  return (data.items ?? []) as GEvent[];
}

/** Create an event on a calendar (LUCK → Google). */
export async function createEvent(
  connectionKey: string,
  calendarId: string,
  body: Record<string, unknown>,
  opts?: { conferenceDataVersion?: number; sendUpdates?: "all" | "externalOnly" | "none" },
): Promise<GEvent> {
  const params = new URLSearchParams();
  if (opts?.conferenceDataVersion) params.set("conferenceDataVersion", String(opts.conferenceDataVersion));
  if (opts?.sendUpdates) params.set("sendUpdates", opts.sendUpdates);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return gcal(connectionKey, `/calendars/${encodeURIComponent(calendarId)}/events${qs}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}



/** Patch an event on a calendar (usado ao arrastar no calendário). */
export async function patchEvent(
  connectionKey: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<GEvent> {
  return gcal(
    connectionKey,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

/** Delete an event on a calendar. */
export async function deleteEvent(
  connectionKey: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await gcal(
    connectionKey,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}



export function eventStart(e: GEvent): string | null {
  const v = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00-03:00` : null);
  return v ? new Date(v).toISOString() : null;
}

export function eventEnd(e: GEvent): string | null {
  const v = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T23:59:00-03:00` : null);
  return v ? new Date(v).toISOString() : null;
}

export function eventPeople(e: GEvent): string | null {
  const names = (e.attendees ?? [])
    .map((a) => a.displayName || a.email)
    .filter(Boolean) as string[];
  if (names.length === 0) return e.organizer?.displayName ?? e.organizer?.email ?? null;
  return names.slice(0, 8).join(", ");
}

/**
 * Map a calendar (account + calendar name) to the LUCK source colour and
 * whether it's specifically a "Reunião" bucket.
 *
 * Rules:
 * - ana@devoresnacks.com → always Devore.
 * - anaduquek@gmail.com (formerly drabiazinha) → look at the calendar name:
 *     "ana beatriz" / primary → Pessoal
 *     "branding pessoal"      → Bruna
 *     "pagament*"             → Pessoal
 *     "reuni*"                → Pessoal, marcado como Reunião
 *     qualquer outra           → Pessoal
 */
export function classifyCalendar(
  accountDefault: SourceKey,
  cal: GCalendar,
): { source: SourceKey; isMeeting: boolean; skip?: boolean } {
  const name = (cal.summaryOverride || cal.summary || "").toLowerCase();
  const id = (cal.id || "").toLowerCase();

  // Bruna fica só manual dentro do LUCK — nunca puxar agendas dela.
  if (
    name.includes("branding pessoal") ||
    name.includes("trabalho bruna") ||
    name.includes("bruna bergamini") ||
    name === "bruna"
  )
    return { source: "bruna", isMeeting: false, skip: true };

  // Agenda literalmente chamada "Pessoal" no anaduquek — pedido: não puxar.
  if (name.trim() === "pessoal") return { source: "pessoal", isMeeting: false, skip: true };

  // Qualquer agenda da conta ana@angisaude.com (ou compartilhada da Angi) → Angi.
  if (id.includes("angisaude") || name.includes("angisaude") || name.includes("angi"))
    return { source: "angi", isMeeting: name.includes("reuni") };

  if (accountDefault === "angi") return { source: "angi", isMeeting: name.includes("reuni") };

  // Agenda compartilhada da Devore aparece nas duas contas → sempre Devore.
  if (id.includes("devoresnacks") || name.includes("devoresnacks") || name.includes("devore"))
    return { source: "devore", isMeeting: false };

  if (accountDefault === "devore") return { source: "devore", isMeeting: false };

  if (name.includes("reuni")) return { source: "pessoal", isMeeting: true };

  // ana beatriz, pagamentos, urgente, feriados, primária → Pessoal.
  return { source: "pessoal", isMeeting: false };
}



