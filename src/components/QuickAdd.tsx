import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SOURCES, type SourceKey } from "@/lib/sources";
import { pushToGoogleCalendar } from "@/lib/gcal.functions";
import { createJiraIssue } from "@/lib/jira.functions";


type Kind = "task" | "meeting";

export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [source, setSource] = useState<SourceKey>("pessoal");
  const queryClient = useQueryClient();
  const pushGoogle = useServerFn(pushToGoogleCalendar);
  const pushJira = useServerFn(createJiraIssue);


  const mutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Escreva o que precisa ser feito.");
      if (kind === "task") {
        // Cria tarefa no Anora
        const { data: inserted, error } = await supabase
          .from("tasks")
          .insert({ title: title.trim(), source, due_date: when || null })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        // Se marcou como Angi, cria também no board Angi | Commercial & Marketing (Jira)
        if (source === "angi" && inserted?.id) {
          try {
            const jira = await pushJira({
              data: { summary: title.trim(), dueDate: when || null },
            });
            await supabase
              .from("tasks")
              .update({
                external_system: "jira",
                external_id: jira.key,
                external_url: jira.url,
              })
              .eq("id", inserted.id);
          } catch (e) {
            toast.error(`Jira: ${(e as Error).message}`);
          }
        }
        // Se tem data, empurra pro Google como all-day
        if (when && inserted?.id) {
          try {
            const res = await pushGoogle({
              data: {
                title: title.trim(),
                startsAt: `${when}T09:00:00`,
                allDay: true,
                source,
              },
            });
            if (res.eventId) {
              // Se a tarefa é Angi, external_system/external_url já apontam pro Jira; só guardamos os campos do Google.
              const patch: {
                google_event_id: string;
                google_account: string | null;
                external_url?: string | null;
                external_system?: string | null;
              } = {
                google_event_id: res.eventId,
                google_account: res.calendarId ?? null,
              };
              if (source !== "angi") {
                patch.external_url = res.url;
                patch.external_system = "google_calendar";
              }
              await supabase.from("tasks").update(patch).eq("id", inserted.id);

            }

            return { pushed: true };
          } catch (e) {
            toast.error(`Google Agenda: ${(e as Error).message}`);
          }
        }
        return { pushed: false };

      }
      if (!when) throw new Error("Escolha a data e hora da reunião.");
      const startsAt = new Date(when).toISOString();
      let googleId: string | null = null;
      let googleAccount: string | null = null;
      let externalUrl: string | null = null;
      try {
        const res = await pushGoogle({ data: { title: title.trim(), startsAt, source } });
        googleId = res.eventId ?? null;
        googleAccount = res.calendarId ?? null;
        externalUrl = res.url ?? null;
      } catch (e) {
        toast.error(`Google Agenda: ${(e as Error).message}`);
      }
      const { error } = await supabase.from("meetings").insert({
        title: title.trim(),
        source,
        starts_at: startsAt,
        google_event_id: googleId,
        google_account: googleAccount,
        external_url: externalUrl,
      });
      if (error) throw new Error(error.message);
      return { pushed: Boolean(googleId) };
    },
    onSuccess: (res) => {
      toast.success(
        res?.pushed
          ? `${kind === "task" ? "Tarefa" : "Reunião"} criada e enviada ao Google Agenda`
          : `${kind === "task" ? "Tarefa" : "Reunião"} criada`,
      );
      setTitle("");
      setWhen("");
      setOpen(false);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Adicionar tarefa ou reunião"
        className="fixed bottom-20 right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-xl shadow-primary/30 transition-transform hover:scale-105 md:bottom-6 md:right-6"
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
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
