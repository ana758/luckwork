-- 1) Colunas em tasks para vincular ao CRM Angi
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS crm_lead_id text,
  ADD COLUMN IF NOT EXISTS crm_interaction_id text,
  ADD COLUMN IF NOT EXISTS crm_destination text;

-- Impede duas tarefas para o mesmo lead novo
CREATE UNIQUE INDEX IF NOT EXISTS tasks_crm_lead_unique
  ON public.tasks (crm_lead_id)
  WHERE crm_lead_id IS NOT NULL AND crm_interaction_id IS NULL;

-- Impede duas tarefas para a mesma interação
CREATE UNIQUE INDEX IF NOT EXISTS tasks_crm_interaction_unique
  ON public.tasks (crm_interaction_id)
  WHERE crm_interaction_id IS NOT NULL;

-- 2) Tabela de eventos recebidos do CRM (log/auditoria + dedupe)
CREATE TABLE IF NOT EXISTS public.crm_angi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_angi_events TO authenticated;
GRANT ALL ON public.crm_angi_events TO service_role;

ALTER TABLE public.crm_angi_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read crm angi events"
  ON public.crm_angi_events
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(auth.uid()));

CREATE INDEX IF NOT EXISTS crm_angi_events_created_at_idx
  ON public.crm_angi_events (created_at DESC);