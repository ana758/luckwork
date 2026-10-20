CREATE TABLE public.crm_cleanup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  task_id uuid,
  before jsonb,
  after jsonb,
  reason text
);
GRANT SELECT ON public.crm_cleanup_log TO authenticated;
GRANT ALL ON public.crm_cleanup_log TO service_role;
ALTER TABLE public.crm_cleanup_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read crm cleanup log" ON public.crm_cleanup_log FOR SELECT TO authenticated USING (private.is_active_member(auth.uid()));