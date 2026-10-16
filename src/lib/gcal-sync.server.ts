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
    const { ALLOWED_EMAILS } = await import("./accounts");
    const auto = ALLOWED_EMAILS.includes(email.toLowerCase());
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


/**
 * Todas as conexões de Google Agenda ligadas ao projeto.
 * Aceita GOOGLE_CALENDAR_API_KEY, _1, _2, _3... (a ordem do link não importa,
 * a conta é identificada pelo e-mail da agenda principal).
 */
function connectedAccounts() {
  const known = new Map(GOOGLE_ACCOUNTS.map((a) => [a.envVar, a.defaultSource]));
  return Object.keys(process.env)
    .filter((k) => /^GOOGLE_CALENDAR_API_KEY(_\d+)?$/.test(k) && process.env[k])
    .sort()
    .map((envVar) => ({
      envVar,
      defaultSource: known.get(envVar) ?? ("pessoal" as const),
      key: process.env[envVar] as string,
    }));
}

/** Empresa dona de cada conta, pelo e-mail. */
function sourceForEmail(email: string) {
  const e = email.toLowerCase();
  if (e.includes("angisaude")) return "angi" as const;
  if (e.includes("devoresnacks")) return "devore" as const;
  return "pessoal" as const;
}

type ResolvedAccount = ReturnType<typeof connectedAccounts>[number] & { email: string };

/** Contas conectadas já com o e-mail da agenda principal resolvido. */
async function resolvedAccounts(): Promise<ResolvedAccount[]> {
  const out: ResolvedAccount[] = [];
  for (const acc of connectedAccounts()) {
    try {
      const email = await primaryCalendarId(acc.key);
      out.push({ ...acc, email, defaultSource: sourceForEmail(email) });
    } catch {
      // conta indisponível
    }
  }
  return out;
}

/** Agenda pessoal (anaduquek@gmail.com) — recebe cópia de tudo. */
function personalAccount(accounts: ResolvedAccount[]) {
  return accounts.find((a) => sourceForEmail(a.email) === "pessoal") ?? null;
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

function googleSeriesId(eventId: string) {
  return eventId.replace(/_\d{8}T\d{6}Z$/, "");
}

/**
 * Só é reunião de verdade quando tem horário marcado e o título não é um pedido
 * de preparação ("marcar reunião", "cobrar reunião", "pedir para agendar"...).
 * Dia inteiro e lembretes de agendar nunca viram reunião confirmada.
 */
function isMeetingTitle(title: string, allDay: boolean) {
  if (allDay) return false;
  if (!/\b(reuni[aã]o|reuniao|meeting|call)\b/i.test(title)) return false;
  const prep = /\b(marcar|marque|agendar|agende|pedir|cobrar|confirmar|remarcar|falar|combinar|definir)\b[^·]*\b(reuni[aã]o|reuniao|meeting|call)\b/i;
  return !prep.test(title);
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

  const accounts = await resolvedAccounts();
  if (accounts.length === 0) {
    // Sem conta ligada: não quebra a tela — apenas não importa nada.
    return { imported: 0, accounts: [] as { email: string; count: number }[], notConnected: true as const };
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
  const hiddenSeries = new Set(
    (hiddenTombstones ?? [])
      .filter((r: any) => r.google_account && r.google_event_id)
      .map((r: any) => `${r.google_account}::${googleSeriesId(r.google_event_id)}`),
  );

  // Eventos criados por tarefas já pertencem à tabela de tarefas. Não os
  // reimporta como compromissos, pois isso criaria uma segunda cópia que pode
  // continuar exibindo nome/data antigos depois de uma edição.
  const { data: linkedTasks } = await supabase
    .from("tasks")
    .select("google_account, google_event_id")
    .not("google_event_id", "is", null);
  const linkedTaskPairs = new Set(
    (linkedTasks ?? [])
      .filter((r: any) => r.google_account && r.google_event_id)
      .map((r: any) => `${r.google_account}::${r.google_event_id}`),
  );

  // Carrega regras aprendidas (título → empresa correta).
  const { normalizeTitleKey, inferSourceFromTitle } = await import("./source-rules");
  const { data: rulesData } = await supabase.from("source_rules").select("title_key, source");
  const rulesMap = new Map<string, string>();
  for (const r of rulesData ?? []) rulesMap.set(r.title_key as string, r.source as string);

  const seenSignatures = new Set<string>(); // evita o mesmo evento vindo de 2 contas

  for (const acc of accounts) {
    const accountEmail = acc.email;
    // Importa somente a agenda principal de cada conta conectada. Agendas
    // compartilhadas/assinadas antigas não devem alimentar a LUCK.
    const calendars = (await listCalendars(acc.key)).filter((c) => c.primary);

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
          const sig = meetingSignature(title, startsAt);
          if (
            linkedTaskPairs.has(`${cal.id}::${e.id}`) ||
            hiddenExactPairs.has(`${cal.id}::${e.id}`) ||
            hiddenSeries.has(`${cal.id}::${googleSeriesId(e.id)}`) ||
            hiddenSignatures.has(sig)
          ) {
            return [];
          }
          // Todo compromisso das agendas conectadas entra no calendário da LUCK.
          // A aba Reuniões continua mostrando só o que é reunião de verdade
          // (is_meeting), para não virar espelho da agenda inteira.
          if (seenSignatures.has(sig)) return [];
          seenSignatures.add(sig);
          const learned = rulesMap.get(normalizeTitleKey(title));
          const inferred = inferSourceFromTitle(title);
          const source = learned ?? inferred ?? defaultSource;
          const allDayEvent = Boolean(e.start?.date && !e.start?.dateTime);
          const isMeeting = isMeetingTitle(title, allDayEvent);
          return [{
            title,
            source,
            starts_at: startsAt,
            ends_at: eventEnd(e),
            is_meeting: isMeeting,
            meeting_type: isMeeting ? "Reunião" : "Compromisso",
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

  // Remove cópias históricas que já foram importadas como compromisso apesar
  // de serem a representação de uma tarefa vinculada ao Google.
  if (linkedTaskPairs.size > 0) {
    const { data: linkedMeetingRows } = await supabase
      .from("meetings")
      .select("id, google_account, google_event_id")
      .not("google_event_id", "is", null);
    const duplicateTaskMeetings = (linkedMeetingRows ?? [])
      .filter((r: any) => linkedTaskPairs.has(`${r.google_account}::${r.google_event_id}`))
      .map((r: any) => r.id);
    if (duplicateTaskMeetings.length > 0) {
      await supabase.from("meetings").delete().in("id", duplicateTaskMeetings);
    }
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


// Roteia por empresa → conta do Google (pelo e-mail da conta, não pela ordem
// em que foi conectada):
//   angi   → ana@angisaude.com
//   devore → ana@devoresnacks.com
//   demais → anaduquek@gmail.com
// Além disso, TUDO ganha uma cópia em anaduquek@gmail.com (agenda pessoal).
function pickAccountBySource(accounts: ResolvedAccount[], source?: string | null) {
  const want = source === "angi" ? "angi" : source === "devore" ? "devore" : "pessoal";
  return (
    accounts.find((a) => sourceForEmail(a.email) === want) ??
    personalAccount(accounts) ??
    accounts[0] ??
    null
  );
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

  const accounts = await resolvedAccounts();
  const acc = data.account
    ? accounts.find((a) => a.envVar === data.account || a.email === data.account)
    : pickAccountBySource(accounts, data.source);
  // Nenhuma agenda Google vinculada: salva só na LUCK, sem quebrar a tela.
  if (!acc) {
    return {
      ok: false as const,
      skipped: "no_account" as const,
      eventId: null,
      calendarId: null,
      url: null,
      meetLink: data.meetLink ?? null,
      mirrorEventId: null,
      mirrorAccount: null,
    };
  }

  const calendarId = acc.email;


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

  // Cópia na agenda pessoal (anaduquek@gmail.com), onde a Ana controla tudo.
  let mirrorEventId: string | null = null;
  let mirrorAccount: string | null = null;
  const personal = personalAccount(accounts);
  if (personal && personal.email !== acc.email) {
    try {
      const mirrorBody = { ...body } as Record<string, unknown>;
      delete mirrorBody.conferenceData;
      delete mirrorBody.attendees;
      if (meetLink) {
        mirrorBody.description = [data.notes ?? "", `Link: ${meetLink}`]
          .filter(Boolean)
          .join("\n\n");
      }
      const copy = await createEvent(personal.key, personal.email, mirrorBody);
      mirrorEventId = copy.id ?? null;
      mirrorAccount = personal.email;
    } catch {
      // cópia é best-effort — não bloqueia o evento principal
    }
  }

  return {
    ok: true,
    eventId: created.id,
    calendarId,
    url: created.htmlLink ?? null,
    meetLink,
    mirrorEventId,
    mirrorAccount,
  };

}


/** Cópia do evento na agenda pessoal, se existir. */
async function findMirrorRef(supabase: any, googleEventId: string) {
  for (const table of ["meetings", "tasks"] as const) {
    const { data } = await supabase
      .from(table)
      .select("mirror_event_id, mirror_account")
      .eq("google_event_id", googleEventId)
      .not("mirror_event_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (data?.mirror_event_id && data?.mirror_account) {
      return { eventId: data.mirror_event_id as string, account: data.mirror_account as string };
    }
  }
  return null;
}


export async function runMoveGoogleEvent(
  supabase: any,
  userId: string,
  data: {
    googleAccount: string;
    googleEventId: string;
    startsAt: string;
    endsAt?: string | null;
    allDay?: boolean;
  },
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
      if (data.allDay) {
        // Evento de dia inteiro continua de dia inteiro no Google (datas, sem hora).
        const brt = (d: Date) => new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
        const day = brt(start);
        const next = new Date(`${day}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        await patchEvent(acc.key, data.googleAccount, data.googleEventId, {
          start: { date: day },
          end: { date: next.toISOString().slice(0, 10) },
        });
        return { ok: true };
      }
      await patchEvent(acc.key, data.googleAccount, data.googleEventId, {
        start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
        end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
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
    allDay?: boolean;
  },
) {
  await assertMember(supabase, userId);
  const accounts = connectedAccounts();
  const body: Record<string, unknown> = {};
  if (data.title !== undefined) body.summary = data.title;
  if (data.notes !== undefined) body.description = data.notes ?? "";
  if (data.location !== undefined) body.location = data.location ?? "";
  if (data.startsAt && data.allDay) {
    const day = data.startsAt.slice(0, 10);
    const next = new Date(`${day}T00:00:00`);
    next.setDate(next.getDate() + 1);
    body.start = { date: day };
    body.end = { date: next.toISOString().slice(0, 10) };
  } else if (data.startsAt) {
    const start = new Date(data.startsAt);
    const end = data.endsAt
      ? new Date(data.endsAt)
      : new Date(start.getTime() + 60 * 60 * 1000);
    body.start = { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" };
    body.end = { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" };
  }
  let lastErr: unknown = null;
  const mirror = await findMirrorRef(supabase, data.googleEventId);
  for (const acc of accounts) {
    try {
      await patchEvent(acc.key, data.googleAccount, data.googleEventId, body);
      if (mirror) {
        for (const a of accounts) {
          try {
            await patchEvent(a.key, mirror.account, mirror.eventId, body);
            break;
          } catch {
            /* tenta a próxima conta */
          }
        }
      }
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
  const mirror = await findMirrorRef(supabase, data.googleEventId);
  const removeMirror = async () => {
    if (!mirror) return;
    for (const a of accounts) {
      try {
        await deleteEvent(a.key, mirror.account, mirror.eventId);
        return;
      } catch {
        /* tenta a próxima conta */
      }
    }
  };
  let lastErr: unknown = null;
  for (const acc of accounts) {
    try {
      await deleteEvent(acc.key, data.googleAccount, data.googleEventId);
      await removeMirror();
      return { ok: true };
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      // Já apagado/inexistente no Google → sucesso idempotente.
      if (/\[(404|410)\]/.test(msg)) {
        await removeMirror();
        return { ok: true, alreadyGone: true };
      }
      lastErr = e;
    }
  }
  throw new Error(`Não consegui apagar no Google: ${(lastErr as Error)?.message ?? "erro"}`);

}



