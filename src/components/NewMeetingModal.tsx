import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pushToGoogleCalendar } from "@/lib/gcal.functions";
import { SOURCES, SOURCE_DOT, type SourceKey } from "@/lib/sources";

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const WEEKDAYS: { key: string; label: string }[] = [
  { key: "SU", label: "D" },
  { key: "MO", label: "S" },
  { key: "TU", label: "T" },
  { key: "WE", label: "Q" },
  { key: "TH", label: "Q" },
  { key: "FR", label: "S" },
  { key: "SA", label: "S" },
];

export function NewMeetingModal({
  onClose,
  defaultDate,
}: {
  onClose: () => void;
  defaultDate?: string;
}) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(defaultDate ? `${defaultDate}T09:00` : nowLocalInput());
  const [durationMin, setDurationMin] = useState(60);
  const [source, setSource] = useState<SourceKey>("pessoal");
  const [location, setLocation] = useState("");
  const [people, setPeople] = useState("");
  const [notes, setNotes] = useState("");
  const [withMeet, setWithMeet] = useState(true);
  const [meetLink, setMeetLink] = useState("");
  const [attendees, setAttendees] = useState("");
  const [recurrent, setRecurrent] = useState(false);
  const [recMode, setRecMode] = useState<"weekly" | "monthly">("weekly");
  const [days, setDays] = useState<string[]>([]);
  const [weeks, setWeeks] = useState(8);
  const qc = useQueryClient();
  const pushGoogle = useServerFn(pushToGoogleCalendar);


  function toggleDay(k: string) {
    setDays((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Título é obrigatório.");
      if (!when) throw new Error("Escolha data e hora.");
      const startsAt = new Date(when).toISOString();
      const endsAt = new Date(new Date(when).getTime() + durationMin * 60 * 1000).toISOString();

      const attendeeList = attendees
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => /.+@.+\..+/.test(s));

      const recurrence: string[] = [];
      if (recurrent && recMode === "monthly") {
        recurrence.push(
          `RRULE:FREQ=MONTHLY;BYMONTHDAY=${new Date(when).getDate()};COUNT=${Math.max(1, weeks)}`,
        );
      } else if (recurrent && days.length) {
        recurrence.push(
          `RRULE:FREQ=WEEKLY;BYDAY=${days.join(",")};COUNT=${Math.max(1, weeks) * days.length}`,
        );
      } else if (recurrent) {
        recurrence.push(`RRULE:FREQ=WEEKLY;COUNT=${Math.max(1, weeks)}`);
      }


      const { data: inserted, error } = await supabase
        .from("meetings")
        .insert({
          title: title.trim(),
          source,
          starts_at: startsAt,
          ends_at: endsAt,
          location: location.trim() || null,
          people: [people.trim(), attendeeList.join(", ")].filter(Boolean).join(" · ") || null,
          notes: notes.trim() || null,
          meeting_type: "Reunião",
          external_url: !withMeet && meetLink.trim() ? meetLink.trim() : null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      if (inserted?.id) {
        void (async () => {
          try {
            const res = await pushGoogle({
              data: {
                title: title.trim(),
                startsAt,
                endsAt,
                source,
                notes: notes.trim() || null,
                location: location.trim() || null,
                withMeetLink: withMeet,
                meetLink: !withMeet && meetLink.trim() ? meetLink.trim() : null,
                attendees: attendeeList.length ? attendeeList : null,
                recurrence: recurrence.length ? recurrence : null,
              },
            });
            await supabase
              .from("meetings")
              .update({
                google_event_id: res.eventId ?? null,
                google_account: res.calendarId ?? null,
                mirror_event_id: res.mirrorEventId ?? null,
                mirror_account: res.mirrorAccount ?? null,
                external_url: res.meetLink ?? res.url ?? null,
              })
              .eq("id", inserted.id);
            qc.invalidateQueries({ queryKey: ["meetings"] });
            toast.success(
              res.meetLink
                ? "Reunião criada com link do Meet"
                : "Reunião criada no Google Agenda",
            );
          } catch (e) {
            toast.error(`Google Agenda: ${(e as Error).message}`);
          }
        })();
      }
    },
    onSuccess: () => {
      toast.success("Reunião adicionada");
      qc.invalidateQueries({ queryKey: ["meetings"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-4 md:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-medium">Nova reunião</h3>

        <label className="text-xs text-muted-foreground">Título</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex.: alinhamento com fornecedor"
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Início</label>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Duração</label>
            <select
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>1 h</option>
              <option value={90}>1 h 30</option>
              <option value={120}>2 h</option>
            </select>
          </div>
        </div>

        <label className="text-xs text-muted-foreground">Empresa</label>
        <div className="mb-3 mt-1 grid grid-cols-4 gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={`rounded-md border px-2 py-1.5 text-xs ${
                source === s.key ? "border-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              <span
                className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${SOURCE_DOT[s.key]}`}
              />
              {s.label}
            </button>
          ))}
        </div>

        <label className="text-xs text-muted-foreground">Local</label>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Opcional"
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="mb-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={withMeet}
            onChange={(e) => setWithMeet(e.target.checked)}
            className="h-4 w-4"
          />
          Gerar link do Google Meet automaticamente
        </label>
        {!withMeet && (
          <>
            <label className="text-xs text-muted-foreground">Link da reunião (Meet, Zoom…)</label>
            <input
              value={meetLink}
              onChange={(e) => setMeetLink(e.target.value)}
              placeholder="https://…"
              className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </>
        )}

        <label className="text-xs text-muted-foreground">
          Convidados (e-mails separados por vírgula)
        </label>
        <input
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          placeholder="fulano@ex.com, ciclana@ex.com"
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="text-xs text-muted-foreground">Participantes (nomes)</label>
        <input
          value={people}
          onChange={(e) => setPeople(e.target.value)}
          placeholder="Opcional"
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="mb-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={recurrent}
            onChange={(e) => setRecurrent(e.target.checked)}
            className="h-4 w-4"
          />
          Recorrente semanal
        </label>
        {recurrent && (
          <div className="mb-3 rounded-md border bg-background/40 p-2">
            <div className="mb-2 text-xs text-muted-foreground">Dias da semana</div>
            <div className="mb-3 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.key}
                  onClick={() => toggleDay(d.key)}
                  className={`rounded-md border px-1 py-1.5 text-xs ${
                    days.includes(d.key)
                      ? "border-foreground bg-accent font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <label className="text-xs text-muted-foreground">Repetir por (semanas)</label>
            <input
              type="number"
              min={1}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              O horário da recorrência é o mesmo do "Início".
            </p>
          </div>
        )}

        <label className="text-xs text-muted-foreground">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="mb-3 mt-1 min-h-[6rem] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {save.isPending ? "Criando…" : "Criar reunião"}
          </button>
        </div>
      </div>
    </div>
  );
}
