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
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string }[];
  organizer?: { email?: string; displayName?: string };
  hangoutLink?: string;
};

/** Primary calendar id (the account's own e-mail). */
export async function primaryCalendarId(connectionKey: string): Promise<string> {
  const data = await gcal(connectionKey, "/users/me/calendarList?maxResults=250");
  const items: { id: string; primary?: boolean }[] = data.items ?? [];
  const primary = items.find((i) => i.primary);
  return primary?.id ?? "primary";
}

/** Events in a window on the account's primary calendar. */
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

/** Create an event on the account's primary calendar (Anora → Google). */
export async function createEvent(
  connectionKey: string,
  calendarId: string,
  body: Record<string, unknown>,
): Promise<GEvent> {
  return gcal(connectionKey, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function eventStart(e: GEvent): string | null {
  const v = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : null);
  return v ? new Date(v).toISOString() : null;
}

export function eventEnd(e: GEvent): string | null {
  const v = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T23:59:00` : null);
  return v ? new Date(v).toISOString() : null;
}

export function eventPeople(e: GEvent): string | null {
  const names = (e.attendees ?? [])
    .map((a) => a.displayName || a.email)
    .filter(Boolean) as string[];
  if (names.length === 0) return e.organizer?.displayName ?? e.organizer?.email ?? null;
  return names.slice(0, 8).join(", ");
}
