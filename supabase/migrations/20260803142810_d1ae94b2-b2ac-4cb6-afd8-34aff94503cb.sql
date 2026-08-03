-- 1) Owner check (private schema, not exposed via API)
CREATE OR REPLACE FUNCTION private.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = private, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = _user_id
      AND lower(coalesce(u.email,'')) IN ('ana@devoresnacks.com','anaduquek@gmail.com','drabiazinha@gmail.com')
  );
$$;

REVOKE ALL ON FUNCTION private.is_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_owner(uuid) TO authenticated, service_role;

-- 2) Restrict membership management to owners
DROP POLICY IF EXISTS "active members manage members" ON public.workspace_members;
DROP POLICY IF EXISTS "active members delete members" ON public.workspace_members;
DROP POLICY IF EXISTS "member reads own row" ON public.workspace_members;

CREATE POLICY "owners manage members" ON public.workspace_members
FOR UPDATE TO authenticated
USING (private.is_owner(auth.uid()))
WITH CHECK (private.is_owner(auth.uid()));

CREATE POLICY "owners delete members" ON public.workspace_members
FOR DELETE TO authenticated
USING (private.is_owner(auth.uid()) AND user_id <> auth.uid());

CREATE POLICY "read own row or owner reads all" ON public.workspace_members
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR private.is_owner(auth.uid()));

-- 3) Move remaining policies off the API-exposed public.is_active_member
DROP POLICY IF EXISTS "members read ai memory" ON public.ai_memory;
DROP POLICY IF EXISTS "members insert ai memory" ON public.ai_memory;
DROP POLICY IF EXISTS "members update ai memory" ON public.ai_memory;
DROP POLICY IF EXISTS "members delete ai memory" ON public.ai_memory;

CREATE POLICY "members read ai memory" ON public.ai_memory
FOR SELECT TO authenticated USING (private.is_active_member(auth.uid()));
CREATE POLICY "members insert ai memory" ON public.ai_memory
FOR INSERT TO authenticated WITH CHECK (private.is_active_member(auth.uid()));
CREATE POLICY "members update ai memory" ON public.ai_memory
FOR UPDATE TO authenticated USING (private.is_active_member(auth.uid())) WITH CHECK (private.is_active_member(auth.uid()));
CREATE POLICY "members delete ai memory" ON public.ai_memory
FOR DELETE TO authenticated USING (private.is_active_member(auth.uid()));

DROP POLICY IF EXISTS "members manage rules" ON public.source_rules;
CREATE POLICY "members manage rules" ON public.source_rules
FOR ALL TO authenticated
USING (private.is_active_member(auth.uid()))
WITH CHECK (private.is_active_member(auth.uid()));

-- 4) Stop exposing the membership check through the public API schema
REVOKE EXECUTE ON FUNCTION public.is_active_member(uuid) FROM authenticated, anon;