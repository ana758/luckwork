import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, X, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { SyncGoogleButton } from "@/components/SyncGoogleButton";
import { MeetingEditModal } from "@/components/MeetingEditModal";
import { NewMeetingModal } from "@/components/NewMeetingModal";
import { useMeetings } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { deleteGoogleEvent } from "@/lib/gcal.functions";
import { SOURCE_DOT, SOURCE_LABEL, type Meeting } from "@/lib/sources";

export const Route = createFileRoute("/_authenticated/reunioes")({
  head: () => ({
    meta: [
      { title: "Reuniões · LUCK" },
      {
        name: "description",
        content: "Todas as suas reuniões com tipo, participantes e anotações recebidas por e-mail.",
      },
      { property: "og:title", content: "Reuniões · LUCK" },
      { property: "og:description", content: "Reuniões com participantes e anotações." },
    ],
  }),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { data: meetings = [], isLoading } = useMeetings();
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const delGoogle = useServerFn(deleteGoogleEvent);

  const now = Date.now();
  const upcoming = meetings.filter((m) => new Date(m.starts_at).getTime() >= now);
  const past = meetings.filter((m) => new Date(m.starts_at).getTime() < now).reverse();
  const allIds = useMemo(() => meetings.map((m) => m.id), [meetings]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      if (ids.length === 0) return { count: 0, googlePromise: Promise.resolve(0) };
      const chosen = meetings.filter((m) => ids.includes(m.id)) as Array<
        Meeting & { google_event_id?: string | null; google_account?: string | null }
      >;
      const googleLinked = chosen.filter((m) => m.google_event_id && m.google_account);

      // Soft-delete (hidden=true) itens vindos do Google para impedir
      // reimportação na próxima sync. Também esconde clones do mesmo evento
      // que aparecem por agendas compartilhadas diferentes.
      const ops: Promise<any>[] = [];
      for (const m of chosen) {
        ops.push(
          Promise.resolve(
            supabase
              .from("meetings")
              .update({ hidden: true })
              .eq("title", m.title)
              .eq("starts_at", m.starts_at),
          ),
        );
      }
      const results = await Promise.all(ops);
      const err = results.find((r: any) => r?.error)?.error;
      if (err) throw new Error(err.message);

      const googlePromise = Promise.allSettled(
        googleLinked.flatMap((m) => {
          if (!m.google_account || !m.google_event_id) return [];
          return [
            delGoogle({
              data: { googleAccount: m.google_account, googleEventId: m.google_event_id },
            }),
          ];
        }),
      ).then((r) => r.filter((x) => x.status === "rejected").length);
      return { count: ids.length, googlePromise };
    },
    onMutate: async () => {
      const ids = Array.from(selected);
      await qc.cancelQueries({ queryKey: ["meetings"] });
      const prev = qc.getQueryData<Meeting[]>(["meetings"]);
      qc.setQueryData<Meeting[]>(["meetings"], (old) =>
        (old ?? []).filter((m) => !ids.includes(m.id)),
      );
      exitSelect();
      return { prev };
    },
    onSuccess: async (r) => {
      if (r.count === 0) return;
      toast.success(`${r.count} reuniões removidas`);
      const fails = await r.googlePromise;
      if (fails) toast.warning(`${fails} não removidas no Google Agenda (removidas do LUCK)`);
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["meetings"], ctx.prev);
      toast.error(e.message);
    },
  });

  const onCardClick = (m: Meeting) => {
    if (selectMode) toggle(m.id);
    else setEditing(m);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold tracking-tight">Reuniões</h1>
          <p className="text-sm text-muted-foreground">
            {selectMode
              ? "Toque para selecionar. Use apagar para remover em massa."
              : "Toque em qualquer reunião para editar ou remover."}
          </p>
        </div>
        {!selectMode ? (
          <>
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <CheckSquare className="h-4 w-4" /> Selecionar
            </button>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Nova reunião
            </button>
            <SyncGoogleButton />
          </>
        ) : (
          <>
            <button
              onClick={() => setSelected(new Set(allSelected ? [] : allIds))}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              {allSelected ? "Desmarcar tudo" : "Selecionar tudo"}
            </button>
            <button
              disabled={selected.size === 0 || bulkDelete.isPending}
              onClick={() => {
                if (confirm(`Apagar ${selected.size} reunião(ões)?`)) bulkDelete.mutate();
              }}
              className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {bulkDelete.isPending ? "Apagando…" : `Apagar (${selected.size})`}
            </button>
            <button
              onClick={exitSelect}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <X className="h-4 w-4" /> Cancelar
            </button>
          </>
        )}
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <Section
            title="Próximas"
            items={upcoming}
            empty="Nenhuma reunião marcada."
            onOpen={onCardClick}
            selectMode={selectMode}
            selected={selected}
          />
          <Section
            title="Anteriores"
            items={past}
            empty="Nada por aqui ainda."
            onOpen={onCardClick}
            selectMode={selectMode}
            selected={selected}
          />
        </>
      )}

      {editing && <MeetingEditModal meeting={editing} onClose={() => setEditing(null)} />}
      {creating && <NewMeetingModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function Section({
  title,
  items,
  empty,
  onOpen,
  selectMode,
  selected,
}: {
  title: string;
  items: Meeting[];
  empty: string;
  onOpen: (m: Meeting) => void;
  selectMode: boolean;
  selected: Set<string>;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((m) => {
            const isSel = selected.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => onOpen(m)}
                className={`flex w-full items-start gap-3 rounded-xl border border-l-4 border-l-reuniao bg-card p-3 text-left hover:bg-accent/40 ${
                  selectMode && isSel ? "ring-2 ring-primary" : ""
                }`}
              >
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onOpen(m)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{m.title}</p>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[m.source]}`} />
                      {SOURCE_LABEL[m.source]}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(m.starts_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {(m.meeting_type || m.people) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[m.meeting_type, m.people].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {m.notes && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{m.notes}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
