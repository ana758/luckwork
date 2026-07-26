CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_unique
  ON public.tasks (created_by, external_system, external_id)
  WHERE external_system IS NOT NULL AND external_id IS NOT NULL;