
-- Dedupe de eventos do CRM
CREATE UNIQUE INDEX IF NOT EXISTS crm_angi_events_event_id_key
  ON public.crm_angi_events (event_id);

-- Upserts do webhook precisam de índice único parcial nessas colunas
CREATE UNIQUE INDEX IF NOT EXISTS tasks_crm_lead_id_key
  ON public.tasks (crm_lead_id)
  WHERE crm_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_crm_interaction_id_key
  ON public.tasks (crm_interaction_id)
  WHERE crm_interaction_id IS NOT NULL;
