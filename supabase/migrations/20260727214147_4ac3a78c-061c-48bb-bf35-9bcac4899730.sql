
-- push_subscriptions: restrict to owner
DROP POLICY IF EXISTS "members manage push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "own push_subscriptions select" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own push_subscriptions insert" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND private.is_active_member(auth.uid()));
CREATE POLICY "own push_subscriptions update" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own push_subscriptions delete" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- workspace_members: only own row visible
DROP POLICY IF EXISTS "member reads own row" ON public.workspace_members;
CREATE POLICY "member reads own row" ON public.workspace_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());
