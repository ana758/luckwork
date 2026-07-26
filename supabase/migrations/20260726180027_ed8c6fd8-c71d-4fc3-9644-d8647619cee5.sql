-- 1) Lock down SECURITY DEFINER function: is_active_member
REVOKE EXECUTE ON FUNCTION public.is_active_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_member(uuid) TO authenticated;

-- 2) Explicit INSERT policy on workspace_members: block direct client inserts.
-- Membership rows are created exclusively by the SECURITY DEFINER trigger
-- public.handle_new_user, which runs as the function owner and is not subject
-- to RLS. This policy makes the fail-closed behavior explicit and prevents
-- privilege escalation via client-side inserts (e.g. self-granting 'active').
CREATE POLICY "Block direct client inserts on workspace_members"
ON public.workspace_members
FOR INSERT
TO authenticated, anon
WITH CHECK (false);