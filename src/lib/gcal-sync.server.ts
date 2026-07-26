/**
 * Server-only Google Calendar sync logic. Imported dynamically by gcal.functions.ts.
 */
import {
  GOOGLE_ACCOUNTS,
  createEvent,
  eventEnd,
  eventPeople,
  eventStart,
  listEvents,
  primaryCalendarId,
} from "./gcal.server";

async function assertMember(supabase: any, userId: string) {
  const { data } = await supabase
    .from("workspace_members")
    .select("status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Sem permissão");
}

function connectedAccounts() {
  return GOOGLE_ACCOUNTS.map((a) => ({ ...a, key: process.env[a.envVar] })).filter(
    (a): a is (typeof GOOGLE_ACCOUNTS)[number] & { key: string } => Boolean(a.key),
  );
}

export async function runListAccounts() {
  const out: { email: string; source: string; envVar: string }[] = [];
  for (const acc of connectedAccounts()) {
    try {
      out.push({
        email: await primaryCalendarId(acc.key),
        source: acc.defaultSource,
        envVar: acc.envVar,
      });
    } catch {
      // conta indisponível — ignora na listagem
    }
  }
  return { accounts: out };
}

export async function runCalendarSync(supabase: any, userId: string) {
  await assertMember(supabase, userId);

  const accounts = connectedAccounts();
  if (accounts.length === 0) {
    throw new Error("Nenhuma conta do Google Agenda conectada ao projeto.");
  }

  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();

  let imported = 0;
  const perAccount: { email: string; count: number }[] = [];

  for (const acc of accounts) {
    const calendarId = await primaryCalendarId(acc.key);
    const events = await listEvents(acc.key, calendarId, timeMin, timeMax);

    const rows = events
      .filter((e) => e.status !== "cancelled" && eventStart(e))
      .map((e) => ({
        title: e.summary?.trim() || "(sem título)",
        source: acc.defaultSource,
        starts_at: eventStart(e)!,
        ends_at: eventEnd(e),
        meeting_type: e.hangoutLink ? "Online" : null,
        people: eventPeople(e),
        notes: e.description?.slice(0, 4000) ?? null,
        external_url: e.hangoutLink ?? e.htmlLink ?? null,
        google_event_id: e.id,
        google_account: calendarId,
        synced_at: new Date().toISOString(),
      }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("meetings")
        .upsert(rows, { onConflict: "google_account,google_event_id" });
      if (error) throw new Error(error.message);
    }

    imported += rows.length;
    perAccount.push({ email: calendarId, count: rows.length });
  }

  return { imported, accounts: perAccount };
}

export async function runCalendarPush(
  supabase: any,
  userId: string,
  data: {
    title: string;
    startsAt: string;
    endsAt?: string | null;
    notes?: string | null;
    account?: string | null;
  },
) {
  await assertMember(supabase, userId);

  const accounts = connectedAccounts();
  const acc = data.account
    ? accounts.find((a) => a.envVar === data.account)
    : accounts[0];
  if (!acc) throw new Error("Conta do Google Agenda não encontrada.");

  const calendarId = await primaryCalendarId(acc.key);
  const start = new Date(data.startsAt);
  const end = data.endsAt ? new Date(data.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);

  const created = await createEvent(acc.key, calendarId, {
    summary: data.title,
    description: data.notes ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  });

  return { ok: true, eventId: created.id, calendarId, url: created.htmlLink ?? null };
}
