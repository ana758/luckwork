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

function normalizedMeetingTitle(title: string) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function meetingSignature(title: string, startsAt: string) {
  return `${normalizedMeetingTitle(title)}::${new Date(startsAt).toISOString()}`;
}

function isMeetingTitle(title: string) {
  return /\b(reuni[aã]o|reuniao|meeting|call)\b/i.test(title);
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

  // Tombstones locais: quando a Ana apaga no LUCK, mantemos hidden=true para
  // impedir que o mesmo compromisso volte de outra agenda compartilhada.
  const { data: hiddenTombstones } = await supabase
    .from("meetings")
    .select("title, starts_at, google_account, google_event_id")
    .eq("hidden", true)
    .gte("starts_at", timeMin)
    .lte("starts_at", timeMax);
  const hiddenExactPairs = new Set(
    (hiddenTombstones ?? [])
      .filter((r: any) => r.google_account && r.google_event_id)
      .map((r: any) => `${r.google_account}::${r.google_event_id}`),
  );
  const hiddenSignatures = new Set(
    (hiddenTombstones ?? [])
      .filter((r: any) => r.title && r.starts_at)
      .map((r: any) => meetingSignature(r.title, r.starts_at)),
  );

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
      const { source: defaultSource, skip } = classifyCalendar(acc.defaultSource, cal);
      if (skip) continue;
      const events = await listEvents(acc.key, cal.id, timeMin, timeMax);
      const candidates = events.filter((e) => e.status !== "cancelled" && eventStart(e));


      const rows = candidates
        .flatMap((e) => {
          const startsAt = eventStart(e);
          if (!startsAt) return [];
          const title = e.summary?.trim() || "(sem título)";
          if (
            hiddenExactPairs.has(`${cal.id}::${e.id}`) ||
            hiddenSignatures.has(meetingSignature(title, startsAt))
          ) {
            return [];
          }
          // A aba Reuniões não é espelho da agenda inteira. Do Google, só entra
          // o que está nomeado como reunião/call no título. Convite, link do
          // Meet ou agenda chamada "reuniões" não bastam, porque isso estava
          // puxando pagamentos, lembretes e tarefas para Reuniões.
          const titleLooksLikeMeeting = isMeetingTitle(title);
          if (!titleLooksLikeMeeting) {
            return [];
          }
          const learned = rulesMap.get(normalizeTitleKey(title));
          const inferred = inferSourceFromTitle(title);
          const source = learned ?? inferred ?? defaultSource;
          return [{
            title,
            source,
            starts_at: startsAt,
            ends_at: eventEnd(e),
            meeting_type: "Reunião",
            people: eventPeople(e),
            location: e.location ?? null,
            notes: e.description?.slice(0, 4000) ?? null,
            external_url: e.hangoutLink ?? e.htmlLink ?? null,
            google_event_id: e.id,
            google_account: cal.id,
            synced_at: new Date().toISOString(),
          }];
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
    .eq("hidden", false)
    .gte("starts_at", timeMin)
    .lte("starts_at", timeMax);
  const orphans = (allSynced ?? [])
    .filter((r: any) => !seenPairs.has(`${r.google_account}::${r.google_event_id}`))
    .map((r: any) => r.id);
  if (orphans.length > 0) {
    await supabase.from("meetings").delete().in("id", orphans);
  }

  // Se o mesmo compromisso já tinha sido importado por outra agenda antes do
  // apagamento, esconde também esses clones locais na próxima sync.
  if (hiddenSignatures.size > 0) {
    const { data: visibleRows } = await supabase
      .from("meetings")
      .select("id, title, starts_at")
      .eq("hidden", false)
      .gte("starts_at", timeMin)
      .lte("starts_at", timeMax);
    const clones = (visibleRows ?? [])
      .filter((r: any) => hiddenSignatures.has(meetingSignature(r.title ?? "", r.starts_at)))
      .map((r: any) => r.id);
    if (clones.length > 0) {
      await supabase.from("meetings").update({ hidden: true }).in("id", clones);
    }
  }

  // IA da LUCK: reclassifica retroativamente qualquer item cujo título
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
    meetLink?: string | null;
    attendees?: string[] | null;
    recurrence?: string[] | null;
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
    body.start = { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" };
    body.end = { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" };
  }

  if (data.withMeetLink && !data.allDay) {
    body.conferenceData = {
      createRequest: {
        requestId: `luck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (data.meetLink) {
    // usuário colou um link (Meet/Zoom/etc): salva como local secundário no corpo
    body.description = [data.notes ?? "", `Link: ${data.meetLink}`].filter(Boolean).join("\n\n");
  }

  if (data.attendees && data.attendees.length) {
    body.attendees = data.attendees.map((email) => ({ email }));
  }

  if (data.recurrence && data.recurrence.length) {
    body.recurrence = data.recurrence;
  }

  const created = await createEvent(acc.key, calendarId, body, {
    conferenceDataVersion: data.withMeetLink && !data.allDay ? 1 : 0,
    sendUpdates: data.attendees && data.attendees.length ? "all" : undefined,
  });
  const meetLink =
    created.hangoutLink ??
    (created as any).conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")
      ?.uri ??
    data.meetLink ??
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
      const msg = (e as Error)?.message ?? "";
      // Já apagado/inexistente no Google → sucesso idempotente.
      if (/\[(404|410)\]/.test(msg)) return { ok: true, alreadyGone: true };
      lastErr = e;
    }
  }
  throw new Error(`Não consegui apagar no Google: ${(lastErr as Error)?.message ?? "erro"}`);
}



