/**
 * Server-only Google Calendar sync logic. Imported dynamically by gcal.functions.ts.
 */
import {
  GOOGLE_ACCOUNTS,
  classifyCalendar,
  createEvent,
  eventEnd,
  eventPeople,
  eventStart,
  listCalendars,
  listEvents,
  primaryCalendarId,
} from "./gcal.server";

async function assertMember(supabase: any, userId: string) {
  let { data } = await supabase
    .from("workspace_members")
    .select("status, email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = u?.user?.email ?? "";
    const auto = ["ana@devoresnacks.com", "anaduquek@gmail.com"].includes(email.toLowerCase());
    await supabaseAdmin
      .from("workspace_members")
      .upsert(
        { user_id: userId, email, status: auto ? "active" : "pending" },
        { onConflict: "user_id" },
      );
    data = { status: auto ? "active" : "pending", email };
  }

  if (data.status !== "active") {
    throw new Error(
      `Acesso pendente para ${data.email}. Entre com ana@devoresnacks.com e aprove em Ajustes → Acessos.`,
    );
  }
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
  const seenPairs = new Set<string>(); // `${google_account}::${google_event_id}`

  for (const acc of accounts) {
    const accountEmail = await primaryCalendarId(acc.key);
    const calendars = (await listCalendars(acc.key)).filter(
      (c) => c.selected !== false && c.accessRole && c.accessRole !== "freeBusyReader",
    );

    let accountCount = 0;

    for (const cal of calendars) {
      const { source, isMeeting } = classifyCalendar(acc.defaultSource, cal);
      const events = await listEvents(acc.key, cal.id, timeMin, timeMax);
      const candidates = events.filter((e) => e.status !== "cancelled" && eventStart(e));

      // Respeita eventos escondidos localmente (soft-delete): não reimportar.
      const ids = candidates.map((e) => e.id);
      const { data: hiddenRows } = await supabase
        .from("meetings")
        .select("google_event_id")
        .eq("google_account", cal.id)
        .eq("hidden", true)
        .in("google_event_id", ids.length ? ids : ["__none__"]);
      const hiddenSet = new Set((hiddenRows ?? []).map((r: any) => r.google_event_id));

      const rows = candidates
        .filter((e) => !hiddenSet.has(e.id))
        .map((e) => ({
          title: e.summary?.trim() || "(sem título)",
          source,
          starts_at: eventStart(e)!,
          ends_at: eventEnd(e),
          meeting_type: isMeeting ? "Reunião" : e.hangoutLink ? "Online" : null,
          people: eventPeople(e),
          notes: e.description?.slice(0, 4000) ?? null,
          external_url: e.hangoutLink ?? e.htmlLink ?? null,
          google_event_id: e.id,
          google_account: cal.id,
          synced_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("meetings")
          .upsert(rows, { onConflict: "google_account,google_event_id" });
        if (error) throw new Error(error.message);
      }

      for (const e of candidates) seenPairs.add(`${cal.id}::${e.id}`);
      accountCount += rows.length;
    }

    imported += accountCount;
    perAccount.push({ email: accountEmail, count: accountCount });
  }

  // Limpeza global: apaga qualquer evento vindo do Google na janela
  // que não apareceu em NENHUMA das agendas processadas nesta sync.
  // Cobre eventos deletados no Google e também agendas que deixaram de
  // ser puxadas (renomeadas/desmarcadas/regras antigas).
  const { data: allSynced } = await supabase
    .from("meetings")
    .select("id, google_account, google_event_id")
    .not("google_event_id", "is", null)
    .gte("starts_at", timeMin)
    .lte("starts_at", timeMax);
  const orphans = (allSynced ?? [])
    .filter((r: any) => !seenPairs.has(`${r.google_account}::${r.google_event_id}`))
    .map((r: any) => r.id);
  if (orphans.length > 0) {
    await supabase.from("meetings").delete().in("id", orphans);
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
