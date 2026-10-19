CREATE TABLE public.email_scanned (message_id text PRIMARY KEY, scanned_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON public.email_scanned TO authenticated;
GRANT ALL ON public.email_scanned TO service_role;
ALTER TABLE public.email_scanned ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read" ON public.email_scanned FOR SELECT TO authenticated USING (private.is_active_member(auth.uid()));
CREATE POLICY "members insert" ON public.email_scanned FOR INSERT TO authenticated WITH CHECK (private.is_active_member(auth.uid()));