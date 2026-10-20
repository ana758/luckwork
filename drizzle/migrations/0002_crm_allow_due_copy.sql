DROP INDEX IF EXISTS public.tasks_crm_interaction_unique;
CREATE UNIQUE INDEX tasks_crm_interaction_unique ON public.tasks (crm_interaction_id, external_id) WHERE crm_interaction_id IS NOT NULL;