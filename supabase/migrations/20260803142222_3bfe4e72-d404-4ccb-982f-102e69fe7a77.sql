ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.tasks_touch_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_status_changed ON public.tasks;
CREATE TRIGGER tasks_status_changed
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_touch_status_changed();

CREATE TABLE IF NOT EXISTS public.email_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_dismissals TO authenticated;
GRANT ALL ON public.email_dismissals TO service_role;
ALTER TABLE public.email_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members manage email dismissals" ON public.email_dismissals;
CREATE POLICY "members manage email dismissals" ON public.email_dismissals
FOR ALL TO authenticated
USING (public.is_active_member(auth.uid()))
WITH CHECK (public.is_active_member(auth.uid()));