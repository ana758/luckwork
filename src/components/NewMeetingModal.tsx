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

export function NewMeetingModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(nowLocalInput());
  const [source, setSource] = useState<SourceKey>("pessoal");
  const [location, setLocation] = useState("");
  const [people, setPeople] = useState("");
  const [notes, setNotes] = useState("");
  const [withMeet, setWithMeet] = useState(true);
  const qc = useQueryClient();
  const pushGoogle = useServerFn(pushToGoogleCalendar);

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Título é obrigatório.");
      if (!when) throw new Error("Escolha data e hora.");
      const startsAt = new Date(when).toISOString();
      const { data: inserted, error } = await supabase
        .from("meetings")
        .insert({
          title: title.trim(),
          source,
          starts_at: startsAt,
          location: location.trim() || null,
          people: people.trim() || null,
          notes: notes.trim() || null,
          meeting_type: "Reunião",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      // Google em background — não bloqueia o fechamento.
      if (inserted?.id) {
        void (async () => {
          try {
            const res = await pushGoogle({
              data: {
                title: title.trim(),
                startsAt,
                source,
                notes: notes.trim() || null,
                location: location.trim() || null,
                withMeetLink: withMeet,
              },
            });
            await supabase
              .from("meetings")
              .update({
                google_event_id: res.eventId ?? null,
                google_account: res.calendarId ?? null,
                external_url: res.meetLink ?? res.url ?? null,
              })
              .eq("id", inserted.id);
            qc.invalidateQueries({ queryKey: ["meetings"] });
            toast.success(
              res.meetLink
                ? "Reunião criada com link do Google Meet"
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
        className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-xl"
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

        <label className="text-xs text-muted-foreground">Quando</label>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

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

        <label className="text-xs text-muted-foreground">Participantes</label>
        <input
          value={people}
          onChange={(e) => setPeople(e.target.value)}
          placeholder="Opcional"
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="text-xs text-muted-foreground">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="mb-3 mt-1 min-h-[6rem] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="mb-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={withMeet}
            onChange={(e) => setWithMeet(e.target.checked)}
            className="h-4 w-4"
          />
          Gerar link do Google Meet automaticamente
        </label>

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
