import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SOURCES, type SourceKey } from "@/lib/sources";
import { pushToGoogleCalendar } from "@/lib/gcal.functions";
import { createJiraIssue } from "@/lib/jira.functions";
import { createNotionDailyPage } from "@/lib/notion.functions";


type Kind = "task" | "meeting";

// Só aparece nestas rotas — no /ai e outras atrapalha o composer.
const VISIBLE_ROUTES = ["/", "/tarefas", "/calendario"];

export function QuickAdd() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [source, setSource] = useState<SourceKey>("pessoal");
  const queryClient = useQueryClient();
  const pushGoogle = useServerFn(pushToGoogleCalendar);
  const pushJira = useServerFn(createJiraIssue);
  const pushNotion = useServerFn(createNotionDailyPage);

  const isVisible = VISIBLE_ROUTES.includes(pathname);

  // Roda integrações em background sem bloquear a UI.
  async function syncTaskIntegrations(
    id: string,
    payload: { title: string; source: SourceKey; when: string },
  ) {
    // Jira (Angi)
    if (payload.source === "angi") {
      try {
        const jira = await pushJira({
          data: { summary: payload.title, dueDate: payload.when || null },
        });
        await supabase
          .from("tasks")
          .update({
            external_system: "jira",
            external_id: jira.key,
            external_url: jira.url,
          })
          .eq("id", id);
        toast.success("Também criada no Jira");
      } catch (e) {
        toast.error(`Jira: ${(e as Error).message}`);
      }
    }
    // Notion (Devore)
    if (payload.source === "devore") {
      try {
        const notion = await pushNotion({
          data: {
            title: payload.title,
            dueDate: payload.when || null,
            status: "todo",
          },
        });
        if (notion?.pageId) {
          await supabase
            .from("tasks")
            .update({
              external_system: "notion",
              external_id: notion.pageId,
              external_url: notion.url,
            })
            .eq("id", id);
          toast.success("Também criada no Notion");
        }
      } catch (e) {
        toast.error(`Notion: ${(e as Error).message}`);
      }
    }
    // Google Agenda (sempre que houver data)
    if (payload.when) {
      try {
        const res = await pushGoogle({
          data: {
            title: payload.title,
            startsAt: `${payload.when}T09:00:00`,
            allDay: true,
            source: payload.source,
          },
        });
        if (res.eventId) {
          const patch: {
            google_event_id: string;
            google_account: string | null;
            external_url?: string | null;
            external_system?: string | null;
          } = {
            google_event_id: res.eventId,
            google_account: res.calendarId ?? null,
          };
          if (payload.source !== "angi" && payload.source !== "devore") {
            patch.external_url = res.url;
            patch.external_system = "google_calendar";
          }
          await supabase.from("tasks").update(patch).eq("id", id);
          toast.success("Também no Google Agenda");
        }
      } catch (e) {
        toast.error(`Google Agenda: ${(e as Error).message}`);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Escreva o que precisa ser feito.");
      const payload = { title: title.trim(), source, when };

      if (kind === "task") {
        const { data: inserted, error } = await supabase
          .from("tasks")
          .insert({ title: payload.title, source, due_date: when || null })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        // Roda integrações em background — não bloqueia o fechamento.
        if (inserted?.id) {
          void syncTaskIntegrations(inserted.id, payload);
        }
        return { kind };
      }

      // meeting
      if (!when) throw new Error("Escolha a data e hora da reunião.");
      const startsAt = new Date(when).toISOString();
      const { data: inserted, error } = await supabase
        .from("meetings")
        .insert({ title: payload.title, source, starts_at: startsAt })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      // Google em background
      if (inserted?.id) {
        void (async () => {
          try {
            const res = await pushGoogle({
              data: { title: payload.title, startsAt, source },
            });
            await supabase
              .from("meetings")
              .update({
                google_event_id: res.eventId ?? null,
                google_account: res.calendarId ?? null,
                external_url: res.url ?? null,
              })
              .eq("id", inserted.id);
            queryClient.invalidateQueries({ queryKey: ["meetings"] });
            toast.success("Também no Google Agenda");
          } catch (e) {
            toast.error(`Google Agenda: ${(e as Error).message}`);
          }
        })();
      }
      return { kind };
    },
    onSuccess: (res) => {
      toast.success(res.kind === "task" ? "Tarefa criada" : "Reunião criada");
      setTitle("");
      setWhen("");
      setOpen(false);
      // Invalida só o necessário — antes invalidava TUDO e travava a UI.
      queryClient.invalidateQueries({ queryKey: [res.kind === "task" ? "tasks" : "meetings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isVisible) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Adicionar tarefa ou reunião"
        className="fixed bottom-24 right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-xl shadow-primary/30 transition-transform hover:scale-105 md:bottom-6 md:right-6"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
      >
        <Plus className="h-5 w-5" />
        Adicionar
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-4 md:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex gap-1 rounded-lg bg-secondary p-1 text-sm">
              {(["task", "meeting"] as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded-md px-2 py-1.5 ${
                    kind === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {k === "task" ? "Tarefa" : "Reunião"}
                </button>
              ))}
            </div>

            <label className="text-xs text-muted-foreground">O quê</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={kind === "task" ? "Ex.: revisar contrato" : "Ex.: call com fornecedor"}
              className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <label className="text-xs text-muted-foreground">
              {kind === "task" ? "Prazo (opcional)" : "Quando"}
            </label>
            <input
              type={kind === "task" ? "date" : "datetime-local"}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mb-3 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <label className="text-xs text-muted-foreground">Empresa</label>
            <div className="mb-1 mt-1 grid grid-cols-4 gap-1">
              {SOURCES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    source === s.key ? "border-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${
                      s.key === "angi"
                        ? "bg-angi"
                        : s.key === "devore"
                          ? "bg-devore"
                          : s.key === "bruna"
                            ? "bg-bruna"
                            : "bg-pessoal"
                    }`}
                  />
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {kind === "meeting" || (kind === "task" && when)
                ? `Também será criado no Google Agenda (${source === "angi" || source === "devore" ? "ana@devoresnacks.com" : "anaduquek@gmail.com"}).`
                : "Adicione uma data pra enviar também ao Google Agenda."}
            </p>


            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {mutation.isPending ? "Adicionando…" : "Adicionar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
