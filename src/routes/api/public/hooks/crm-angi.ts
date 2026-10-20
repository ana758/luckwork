/**
 * Webhook público que recebe eventos do CRM Angi (crm.angisaude.com)
 * e cria/atualiza tarefas na empresa Angi do LUCK.
 *
 * Contrato de payload (POST JSON):
 * {
 *   "event_id": "evt_123",              // obrigatório — usado para dedupe
 *   "type": "lead" | "interaction",     // obrigatório
 *   "lead": {
 *     "id": "lead_123",                 // obrigatório
 *     "name": "Nome do lead",
 *     "stage": "Novo Contato",
 *     "url": "https://crm.angisaude.com/leads/lead_123"
 *   },
 *   "interaction"?: {                   // obrigatório quando type = "interaction"
 *     "id": "int_456",
 *     "title": "Ligação inicial",
 *     "notes": "Texto livre",
 *     "start_date": "2026-11-03",      // início, nunca data do update
 *     "due_date": null                 // prazo final opcional, cria outro compromisso
 *   }
 * }
 *
 * Header obrigatório: X-CRM-Secret: <valor de CRM_ANGI_WEBHOOK_SECRET>
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  crmScheduleDates, crmTaskTitle, isInteractionClosed, isTerminalStage,
  type CrmInteractionDates,
} from "@/lib/crm-dates";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-CRM-Secret, X-Webhook-Secret",
  "Access-Control-Max-Age": "86400",
} as const;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

type LeadPayload = { id: string; name?: string; stage?: string; url?: string };
type InteractionPayload = CrmInteractionDates & {
  id: string;
  title?: string;
  notes?: string;
};

export const Route = createFileRoute("/api/public/hooks/crm-angi")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS }),

      GET: async () =>
        json(200, {
          ok: true,
          endpoint: "crm-angi",
          expects: {
            method: "POST",
            headers: { "X-CRM-Secret": "<segredo>" },
            body: {
              event_id: "string (único)",
              type: "lead | interaction",
              lead: { id: "string", name: "string?", stage: "string?", url: "string?" },
              interaction: {
                id: "string (quando type=interaction)",
                title: "string?",
                notes: "string?",
                start_date: "YYYY-MM-DD (início, obrigatório para agendar)",
                due_date: "YYYY-MM-DD? (prazo final, compromisso separado)",
              },
            },
          },
        }),

      POST: async ({ request }) => {
        const secret = process.env.CRM_ANGI_WEBHOOK_SECRET;
        if (!secret) return json(500, { error: "webhook secret not configured" });

        const provided =
          request.headers.get("x-webhook-secret") ??
          request.headers.get("x-crm-secret") ??
          "";
        if (provided !== secret) return json(401, { error: "invalid secret" });

        let body: any;
        try {
          body = await request.json();
        } catch {
          return json(400, { error: "invalid JSON body" });
        }

        const eventId: string | undefined = body?.event_id;
        const rawType: string | undefined = body?.type;
        const lead: LeadPayload | undefined = body?.lead;
        const interaction: InteractionPayload | undefined = body?.interaction;
        const closed =
          rawType === "interaction_deleted" || rawType === "interaction_completed" ||
          (!!interaction && isInteractionClosed(interaction as any));
        const type = rawType?.startsWith("interaction") ? "interaction" : rawType;

        if (!eventId || typeof eventId !== "string")
          return json(400, { error: "event_id (string) é obrigatório" });
        if (type !== "lead" && type !== "interaction")
          return json(400, { error: 'type deve ser "lead", "interaction", "interaction_deleted" ou "interaction_completed"' });
        if (!lead?.id) return json(400, { error: "lead.id é obrigatório" });
        if (type === "interaction" && !interaction?.id)
          return json(400, { error: "interaction.id é obrigatório quando type=interaction" });

        if (type === "interaction" && interaction && !closed && !crmScheduleDates(interaction).start) {
          return json(422, { error: "Envie interaction.start_date com a data de início. A data do update (when) não agenda compromissos." });
        }

        const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");

        // Dedupe: se já registramos esse event_id, devolve o task_id anterior.
        const { data: prior } = await sb
          .from("crm_angi_events")
          .select("id, task_id, processed_at")
          .eq("event_id", eventId)
          .maybeSingle();
        if (prior?.processed_at) {
          return json(200, { ok: true, deduped: true, task_id: prior.task_id });
        }

        // Registra o evento antes de processar (audit trail).
        if (!prior) {
          const { error: insErr } = await sb.from("crm_angi_events").insert({
            event_id: eventId,
            event_type: type,
            payload: body,
          });
          if (insErr && !/duplicate key|unique/i.test(insErr.message)) {
            return json(500, { error: `log falhou: ${insErr.message}` });
          }
        }

        try {
          const leadName = lead.name?.trim() || `Lead ${lead.id}`;
          const leadUrl = lead.url ?? null;
          let taskId: string | null = null;
          // Etapa: a enviada agora ou a última conhecida do lead.
          let stage = lead.stage ?? null;
          if (!stage) {
            const { data: lt } = await sb.from("tasks").select("notes")
              .eq("external_system", "crm_angi").eq("external_id", `lead:${lead.id}`).maybeSingle();
            stage = lt?.notes?.replace(/^Etapa no CRM:\s*/, "") ?? null;
          }
          const terminal = isTerminalStage(stage);

          if (type === "lead") {
            const title = `[CRM Angi] Novo lead: ${leadName}${
              lead.stage ? ` · ${lead.stage}` : ""
            }`;
            const extId = `lead:${lead.id}`;
            const { data: ex } = await sb.from("tasks").select("id")
              .eq("external_system", "crm_angi").eq("external_id", extId).maybeSingle();
            const fields = {
              title,
              external_url: leadUrl,
              notes: lead.stage ? `Etapa no CRM: ${lead.stage}` : null,
            };
            if (ex) {
              const { error } = await sb.from("tasks").update(fields).eq("id", ex.id);
              if (error) throw new Error(error.message);
              taskId = ex.id;
            } else if (!terminal) {
              const { data, error } = await sb.from("tasks").insert({
                ...fields, source: "angi", status: "todo", priority: "media",
                external_system: "crm_angi", external_id: extId,
                crm_lead_id: lead.id, crm_destination: "crm",
              }).select("id").single();
              if (error) throw new Error(error.message);
              taskId = data?.id ?? null;
            }
          } else if (interaction) {
            const baseId = `interaction:${interaction.id}`;
            const dueId = `${baseId}:due`;
            const { data: existing } = await sb.from("tasks").select("id, external_id")
              .eq("external_system", "crm_angi").in("external_id", [baseId, dueId]);
            const byExt = new Map((existing ?? []).map((t) => [t.external_id, t.id]));

            if (closed) {
              if (byExt.size) {
                await sb.from("tasks").update({ status: "done", completed_at: new Date().toISOString() })
                  .in("id", [...byExt.values()]);
              }
              taskId = byExt.get(baseId) ?? null;
            } else {
              const title = crmTaskTitle(leadName, interaction.notes, interaction.title);
              const dates = crmScheduleDates(interaction);
              const rows = [
                { date: dates.start, external_id: baseId },
                ...(dates.due ? [{ date: dates.due, external_id: dueId }] : []),
              ];
              if (!dates.due && byExt.has(dueId)) {
                await sb.from("tasks").delete().eq("id", byExt.get(dueId)!);
              }
              for (const r of rows) {
                const fields = {
                  title, start_date: r.date, due_date: r.date,
                  external_url: leadUrl, notes: interaction.notes?.trim() || null,
                };
                const id = byExt.get(r.external_id);
                if (id) {
                  // Edição no CRM atualiza a mesma tarefa (mantém o status do LUCK).
                  const { error } = await sb.from("tasks").update(fields).eq("id", id);
                  if (error) throw new Error(error.message);
                  taskId ??= id;
                } else if (!terminal) {
                  const { data, error } = await sb.from("tasks").insert({
                    ...fields, source: "angi", status: "todo", priority: "media",
                    external_system: "crm_angi", external_id: r.external_id,
                    crm_lead_id: lead.id, crm_interaction_id: interaction.id, crm_destination: "crm",
                  }).select("id").single();
                  if (error) throw new Error(error.message);
                  taskId ??= data?.id ?? null;
                }
              }
            }
          }

          await sb
            .from("crm_angi_events")
            .update({ processed_at: new Date().toISOString(), task_id: taskId })
            .eq("event_id", eventId);

          // Notificação in-app.
          await sb.from("notifications").insert({
            title: type === "lead" ? "Novo lead Angi" : "Nova interação Angi",
            body: leadName,
          });

          return json(200, { ok: true, task_id: taskId });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          await sb
            .from("crm_angi_events")
            .update({ error: msg })
            .eq("event_id", eventId);
          return json(500, { error: msg });
        }
      },
    },
  },
});
