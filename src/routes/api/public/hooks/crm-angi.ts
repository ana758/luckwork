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
 *     "when": "2026-07-28T14:00:00Z"
 *   }
 * }
 *
 * Header obrigatório: X-CRM-Secret: <valor de CRM_ANGI_WEBHOOK_SECRET>
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-CRM-Secret",
  "Access-Control-Max-Age": "86400",
} as const;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

type LeadPayload = { id: string; name?: string; stage?: string; url?: string };
type InteractionPayload = {
  id: string;
  title?: string;
  notes?: string;
  when?: string;
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
                when: "ISO date?",
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
        const type: string | undefined = body?.type;
        const lead: LeadPayload | undefined = body?.lead;
        const interaction: InteractionPayload | undefined = body?.interaction;

        if (!eventId || typeof eventId !== "string")
          return json(400, { error: "event_id (string) é obrigatório" });
        if (type !== "lead" && type !== "interaction")
          return json(400, { error: 'type deve ser "lead" ou "interaction"' });
        if (!lead?.id) return json(400, { error: "lead.id é obrigatório" });
        if (type === "interaction" && !interaction?.id)
          return json(400, { error: "interaction.id é obrigatório quando type=interaction" });

        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );

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

          if (type === "lead") {
            const title = `[CRM Angi] Novo lead: ${leadName}${
              lead.stage ? ` · ${lead.stage}` : ""
            }`;
            const { data, error } = await sb
              .from("tasks")
              .upsert(
                {
                  title,
                  source: "angi",
                  status: "todo",
                  priority: "media",
                  external_system: "crm_angi",
                  external_id: `lead:${lead.id}`,
                  external_url: leadUrl,
                  crm_lead_id: lead.id,
                  crm_destination: "crm",
                  notes: lead.stage ? `Etapa no CRM: ${lead.stage}` : null,
                },
                { onConflict: "crm_lead_id", ignoreDuplicates: false },
              )
              .select("id")
              .single();
            if (error) throw new Error(error.message);
            taskId = data?.id ?? null;
          } else {
            const intTitle = interaction!.title?.trim() || "Nova interação";
            const title = `[CRM Angi] ${leadName} · ${intTitle}`;
            const due = interaction!.when
              ? new Date(interaction!.when).toISOString().slice(0, 10)
              : null;
            const { data, error } = await sb
              .from("tasks")
              .upsert(
                {
                  title,
                  source: "angi",
                  status: "todo",
                  priority: "media",
                  due_date: due,
                  external_system: "crm_angi",
                  external_id: `interaction:${interaction!.id}`,
                  external_url: leadUrl,
                  crm_lead_id: lead.id,
                  crm_interaction_id: interaction!.id,
                  crm_destination: "crm",
                  notes: interaction!.notes?.trim() || null,
                },
                { onConflict: "crm_interaction_id", ignoreDuplicates: false },
              )
              .select("id")
              .single();
            if (error) throw new Error(error.message);
            taskId = data?.id ?? null;
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
