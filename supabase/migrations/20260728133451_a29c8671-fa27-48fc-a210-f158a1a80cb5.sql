
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_crm_lead_id_key;
DROP INDEX IF EXISTS public.tasks_crm_lead_id_key;
DROP INDEX IF EXISTS public.tasks_crm_lead_id_unique;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_crm_interaction_id_key;
DROP INDEX IF EXISTS public.tasks_crm_interaction_id_key;
DROP INDEX IF EXISTS public.tasks_crm_interaction_id_unique;
CREATE INDEX IF NOT EXISTS tasks_crm_lead_id_idx ON public.tasks(crm_lead_id) WHERE crm_lead_id IS NOT NULL;
