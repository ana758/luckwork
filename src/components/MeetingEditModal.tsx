import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { patchGoogleEvent } from "@/lib/gcal.functions";
import { SOURCES, SOURCE_DOT, type Meeting, type SourceKey } from "@/lib/sources";

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MeetingEditModal({
  meeting,
  onClose,
}: {
  meeting: Meeting & { google_event_id?: string | null; google_account?: string | null };
  onClose: () => void;
}) {
  const [title, setTitle] = useState(meeting.title);
  const [when, setWhen] = useState(toLocalInput(meeting.starts_at));
  const [source, setSource] = useState<SourceKey>(meeting.source);
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const qc = useQueryClient();
  const patchGoogle = useServerFn(patchGoogleEvent);
  const isFromGoogle = Boolean(meeting.google_event_id);

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Título é obrigatório.");
      const newStart = new Date(when).toISOString();
      const { error } = await supabase
        .from("meetings")
        .update({
          title: title.trim(),
          source,
          notes: notes.trim() || null,
          starts_at: newStart,
        })
        .eq("id", meeting.id);
      if (error) throw new Error(error.message);
      if (source !== meeting.source) {
        const { learnSourceRule } = await import("@/lib/learn-source");
        await learnSourceRule(title.trim(), source);
      }
      // Bilateral: se está vinculado ao Google, atualiza lá também.
      if (meeting.google_event_id && meeting.google_account) {
        try {
          await patchGoogle({
            data: {
              googleAccount: meeting.google_account,
              googleEventId: meeting.google_event_id,
              title: title.trim(),
              startsAt: newStart,
              notes: notes.trim() || null,
            },
          });
          return { synced: true };
        } catch (e) {
          toast.error(`Salvo no Anora, mas não sincronizou com o Google: ${(e as Error).message}`);
        }
      }
      return { synced: false };
    },
    onSuccess: (r) => {
      toast.success(r?.synced ? "Atualizado no Anora e no Google" : "Reunião atualizada");
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const remove = useMutation({
    mutationFn: async () => {
      if (isFromGoogle) {
        // Soft-delete: mantém o vínculo para não reimportar do Google.
        const { error } = await supabase
          .from("meetings")
          .update({ hidden: true })
          .eq("id", meeting.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("meetings").delete().eq("id", meeting.id);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Removido do Anora (Google Agenda não foi alterado)");
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
        <h3 className="mb-3 text-sm font-medium">Editar reunião</h3>

        <label className="text-xs text-muted-foreground">Título</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
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

        <label className="text-xs text-muted-foreground">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <p className="mb-3 text-[11px] text-muted-foreground">
          {isFromGoogle
            ? "Este evento veio do Google. Editar/remover afeta só o Anora — o Google Agenda continua igual."
            : "Este evento foi criado no Anora."}
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            Remover
          </button>
          <div className="ml-auto flex gap-2">
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
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
