
CREATE TABLE public.source_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_key text NOT NULL UNIQUE,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_rules TO authenticated;
GRANT ALL ON public.source_rules TO service_role;
ALTER TABLE public.source_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage rules" ON public.source_rules FOR ALL TO authenticated
  USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));
CREATE TRIGGER touch_source_rules BEFORE UPDATE ON public.source_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
