CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_active_member(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE user_id = _user_id
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION private.is_active_member(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_active_member(uuid) TO authenticated;

ALTER POLICY "members manage access" ON public.access_entries
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));

ALTER POLICY "members manage email accounts" ON public.email_accounts
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));

ALTER POLICY "members manage meetings" ON public.meetings
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));

ALTER POLICY "members manage notifications" ON public.notifications
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));

ALTER POLICY "members manage tasks" ON public.tasks
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));

ALTER POLICY "active members delete members" ON public.workspace_members
  USING (private.is_active_member(auth.uid()));

ALTER POLICY "active members manage members" ON public.workspace_members
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));

ALTER POLICY "member reads own row" ON public.workspace_members
  USING ((user_id = auth.uid()) OR private.is_active_member(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.is_active_member(uuid) FROM PUBLIC, anon, authenticated;