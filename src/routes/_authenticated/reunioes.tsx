import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SyncGoogleButton } from "@/components/SyncGoogleButton";
import { MeetingEditModal } from "@/components/MeetingEditModal";
import { useMeetings } from "@/lib/queries";
import { SOURCE_DOT, SOURCE_LABEL, type Meeting } from "@/lib/sources";

export const Route = createFileRoute("/_authenticated/reunioes")({
  head: () => ({
    meta: [
      { title: "Reuniões · Anora" },
      {
        name: "description",
        content: "Todas as suas reuniões com tipo, participantes e anotações recebidas por e-mail.",
      },
      { property: "og:title", content: "Reuniões · Anora" },
      { property: "og:description", content: "Reuniões com participantes e anotações." },
    ],
  }),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { data: meetings = [], isLoading } = useMeetings();
  const [editing, setEditing] = useState<Meeting | null>(null);
  const now = Date.now();
  const upcoming = meetings.filter((m) => new Date(m.starts_at).getTime() >= now);
  const past = meetings.filter((m) => new Date(m.starts_at).getTime() < now).reverse();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold tracking-tight">Reuniões</h1>
          <p className="text-sm text-muted-foreground">
            Toque em qualquer reunião para editar ou remover (só afeta o Anora).
          </p>
        </div>
        <SyncGoogleButton />
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <Section title="Próximas" items={upcoming} empty="Nenhuma reunião marcada." onOpen={setEditing} />
          <Section title="Anteriores" items={past} empty="Nada por aqui ainda." onOpen={setEditing} />
        </>
      )}

      {editing && <MeetingEditModal meeting={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}


function Section({
  title,
  items,
  empty,
  onOpen,
}: {
  title: string;
  items: Meeting[];
  empty: string;
  onOpen: (m: Meeting) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <button
              key={m.id}
              onClick={() => onOpen(m)}
              className="block w-full rounded-xl border border-l-4 border-l-reuniao bg-card p-3 text-left hover:bg-accent/40"
            >
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
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
