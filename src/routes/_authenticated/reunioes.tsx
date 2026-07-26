import { createFileRoute } from "@tanstack/react-router";
import { useMeetings } from "@/lib/queries";
import { SOURCE_DOT, SOURCE_LABEL } from "@/lib/sources";

export const Route = createFileRoute("/_authenticated/reunioes")({
  head: () => ({
    meta: [
      { title: "Reuniões · Meu Hub" },
      {
        name: "description",
        content: "Todas as suas reuniões com tipo, participantes e anotações recebidas por e-mail.",
      },
      { property: "og:title", content: "Reuniões · Meu Hub" },
      { property: "og:description", content: "Reuniões com participantes e anotações." },
    ],
  }),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { data: meetings = [], isLoading } = useMeetings();
  const now = Date.now();
  const upcoming = meetings.filter((m) => new Date(m.starts_at).getTime() >= now);
  const past = meetings.filter((m) => new Date(m.starts_at).getTime() < now).reverse();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Reuniões</h1>
        <p className="text-sm text-muted-foreground">
          Reuniões aparecem em vermelho no calendário e no início.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <Section title="Próximas" items={upcoming} empty="Nenhuma reunião marcada." />
          <Section title="Anteriores" items={past} empty="Nada por aqui ainda." />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  empty,
}: {
  title: string;
  items: ReturnType<typeof useMeetings>["data"] extends (infer T)[] | undefined ? T[] : never;
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <article key={m.id} className="rounded-xl border border-l-4 border-l-reuniao bg-card p-3">
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
