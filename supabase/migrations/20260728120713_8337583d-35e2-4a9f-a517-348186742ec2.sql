ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications(user_id);

DROP POLICY IF EXISTS "members manage notifications" ON public.notifications;

CREATE POLICY "read own or broadcast notifications"
ON public.notifications FOR SELECT TO authenticated
USING (private.is_active_member(auth.uid()) AND (user_id IS NULL OR user_id = auth.uid()));

CREATE POLICY "insert own notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (private.is_active_member(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "update own or broadcast notifications"
ON public.notifications FOR UPDATE TO authenticated
USING (private.is_active_member(auth.uid()) AND (user_id IS NULL OR user_id = auth.uid()))
WITH CHECK (private.is_active_member(auth.uid()) AND (user_id IS NULL OR user_id = auth.uid()));

CREATE POLICY "delete own or broadcast notifications"
ON public.notifications FOR DELETE TO authenticated
USING (private.is_active_member(auth.uid()) AND (user_id IS NULL OR user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.notifications_set_user_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_set_user_id_trg ON public.notifications;
CREATE TRIGGER notifications_set_user_id_trg
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.notifications_set_user_id();