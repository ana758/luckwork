/**
 * Server-only Google Calendar sync logic. Imported dynamically by gcal.functions.ts.
 */
import {
  GOOGLE_ACCOUNTS,
  classifyCalendar,
  createEvent,
  deleteEvent,
  eventEnd,
  eventPeople,
  eventStart,
  listCalendars,
  listEvents,
  patchEvent,
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

  // Carrega regras aprendidas (título → empresa correta).
  const { normalizeTitleKey, inferSourceFromTitle } = await import("./source-rules");
  const { data: rulesData } = await supabase.from("source_rules").select("title_key, source");
  const rulesMap = new Map<string, string>();
  for (const r of rulesData ?? []) rulesMap.set(r.title_key as string, r.source as string);

  for (const acc of accounts) {
    const accountEmail = await primaryCalendarId(acc.key);
    const calendars = (await listCalendars(acc.key)).filter(
      (c) => c.selected !== false && c.accessRole && c.accessRole !== "freeBusyReader",
    );

    let accountCount = 0;

    for (const cal of calendars) {
      const { source: defaultSource, isMeeting, skip } = classifyCalendar(acc.defaultSource, cal);
      if (skip) continue;
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
        .map((e) => {
          const title = e.summary?.trim() || "(sem título)";
          const learned = rulesMap.get(normalizeTitleKey(title));
          const inferred = inferSourceFromTitle(title);
          const source = learned ?? inferred ?? defaultSource;
          return {
            title,
            source,
            starts_at: eventStart(e)!,
            ends_at: eventEnd(e),
            meeting_type: isMeeting ? "Reunião" : e.hangoutLink ? "Online" : null,
            people: eventPeople(e),
            location: e.location ?? null,
            notes: e.description?.slice(0, 4000) ?? null,
            external_url: e.hangoutLink ?? e.htmlLink ?? null,
            google_event_id: e.id,
            google_account: cal.id,
            synced_at: new Date().toISOString(),
          };
        });

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

  // IA da Anora: reclassifica retroativamente qualquer item cujo título
  // mencione outra empresa (ex.: "Reunião Angi" marcado como Pessoal).
  // Regras aprendidas explicitamente têm precedência e não são sobrescritas.
  // (inferSourceFromTitle já importado acima)
  const [{ data: mAll }, { data: tAll }] = await Promise.all([
    supabase.from("meetings").select("id, title, source").gte("starts_at", timeMin).lte("starts_at", timeMax),
    supabase.from("tasks").select("id, title, source"),
  ]);
  const fix = async (table: "meetings" | "tasks", rows: any[]) => {
    for (const r of rows ?? []) {
      const inferred = inferSourceFromTitle(r.title ?? "");
      if (!inferred || inferred === r.source) continue;
      const key = (r.title ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
      if (rulesMap.has(key)) continue; // usuário definiu regra manual — respeita
      await supabase.from(table).update({ source: inferred }).eq("id", r.id);
    }
  };
  await Promise.all([fix("meetings", mAll ?? []), fix("tasks", tAll ?? [])]);

  return { imported, accounts: perAccount };
}


// Roteia por empresa → conta do Google.
// Angi e Devore vão para ana@devoresnacks.com (GOOGLE_CALENDAR_API_KEY).
// Bruna e Pessoal vão para anaduquek@gmail.com (GOOGLE_CALENDAR_API_KEY_1).
function pickAccountBySource(source?: string | null) {
  const accs = connectedAccounts();
  const wantsDevore = source === "angi" || source === "devore";
  const wantsPessoal = source === "bruna" || source === "pessoal";
  const preferredEnv = wantsDevore
    ? "GOOGLE_CALENDAR_API_KEY"
    : wantsPessoal
      ? "GOOGLE_CALENDAR_API_KEY_1"
      : null;
  return (preferredEnv && accs.find((a) => a.envVar === preferredEnv)) || accs[0] || null;
}

export async function runCalendarPush(
  supabase: any,
  userId: string,
  data: {
    title: string;
    startsAt: string;
    endsAt?: string | null;
    notes?: string | null;
    location?: string | null;
    allDay?: boolean;
    account?: string | null;
    source?: string | null;
    withMeetLink?: boolean;
  },
) {
  await assertMember(supabase, userId);

  const accounts = connectedAccounts();
  const acc = data.account
    ? accounts.find((a) => a.envVar === data.account)
    : pickAccountBySource(data.source);
  if (!acc) throw new Error("Conta do Google Agenda não encontrada.");

  const calendarId = await primaryCalendarId(acc.key);

  const body: Record<string, unknown> = {
    summary: data.title,
    description: data.notes ?? undefined,
    location: data.location ?? undefined,
  };
  if (data.allDay) {
    const day = data.startsAt.slice(0, 10);
    const next = new Date(day + "T00:00:00");
    next.setDate(next.getDate() + 1);
    body.start = { date: day };
    body.end = { date: next.toISOString().slice(0, 10) };
  } else {
    const start = new Date(data.startsAt);
    const end = data.endsAt ? new Date(data.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
    body.start = { dateTime: start.toISOString() };
    body.end = { dateTime: end.toISOString() };
  }

  if (data.withMeetLink && !data.allDay) {
    body.conferenceData = {
      createRequest: {
        requestId: `anora-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const created = await createEvent(acc.key, calendarId, body, {
    conferenceDataVersion: data.withMeetLink && !data.allDay ? 1 : 0,
  });
  const meetLink =
    created.hangoutLink ??
    (created as any).conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")
      ?.uri ??
    null;
  return {
    ok: true,
    eventId: created.id,
    calendarId,
    url: created.htmlLink ?? null,
    meetLink,
  };
}


export async function runMoveGoogleEvent(
  supabase: any,
  userId: string,
  data: { googleAccount: string; googleEventId: string; startsAt: string; endsAt?: string | null },
) {
  await assertMember(supabase, userId);
  const accounts = connectedAccounts();
  let lastErr: unknown = null;
  for (const acc of accounts) {
    try {
      const start = new Date(data.startsAt);
      const end = data.endsAt
        ? new Date(data.endsAt)
        : new Date(start.getTime() + 60 * 60 * 1000);
      await patchEvent(acc.key, data.googleAccount, data.googleEventId, {
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      });
      return { ok: true };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Não consegui atualizar no Google: ${(lastErr as Error)?.message ?? "erro"}`);
}

export async function runPatchGoogleEvent(
  supabase: any,
  userId: string,
  data: {
    googleAccount: string;
    googleEventId: string;
    title?: string;
    startsAt?: string | null;
    endsAt?: string | null;
    notes?: string | null;
    location?: string | null;
  },
) {
  await assertMember(supabase, userId);
  const accounts = connectedAccounts();
  const body: Record<string, unknown> = {};
  if (data.title !== undefined) body.summary = data.title;
  if (data.notes !== undefined) body.description = data.notes ?? "";
  if (data.location !== undefined) body.location = data.location ?? "";
  if (data.startsAt) {
    const start = new Date(data.startsAt);
    const end = data.endsAt
      ? new Date(data.endsAt)
      : new Date(start.getTime() + 60 * 60 * 1000);
    body.start = { dateTime: start.toISOString() };
    body.end = { dateTime: end.toISOString() };
  }
  let lastErr: unknown = null;
  for (const acc of accounts) {
    try {
      await patchEvent(acc.key, data.googleAccount, data.googleEventId, body);
      return { ok: true };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Não consegui atualizar no Google: ${(lastErr as Error)?.message ?? "erro"}`);
}

export async function runDeleteGoogleEvent(
  supabase: any,
  userId: string,
  data: { googleAccount: string; googleEventId: string },
) {
  await assertMember(supabase, userId);
  const accounts = connectedAccounts();
  let lastErr: unknown = null;
  for (const acc of accounts) {
    try {
      await deleteEvent(acc.key, data.googleAccount, data.googleEventId);
      return { ok: true };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Não consegui apagar no Google: ${(lastErr as Error)?.message ?? "erro"}`);
}


