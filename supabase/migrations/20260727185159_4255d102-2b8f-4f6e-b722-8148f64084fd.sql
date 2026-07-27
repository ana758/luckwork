DROP INDEX IF EXISTS public.tasks_external_unique;

CREATE UNIQUE INDEX tasks_external_system_id_unique
ON public.tasks (external_system, external_id)
WHERE external_system IS NOT NULL AND external_id IS NOT NULL;