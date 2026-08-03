DROP POLICY IF EXISTS "members manage email dismissals" ON public.email_dismissals;

CREATE POLICY "members manage email dismissals"
ON public.email_dismissals
FOR ALL
TO authenticated
USING (private.is_active_member(auth.uid()))
WITH CHECK (private.is_active_member(auth.uid()));