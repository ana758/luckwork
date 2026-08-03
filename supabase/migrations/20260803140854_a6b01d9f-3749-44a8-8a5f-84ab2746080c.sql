CREATE TABLE public.ai_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'fact',
  source text NOT NULL DEFAULT 'auto',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_memory TO authenticated;
GRANT ALL ON public.ai_memory TO service_role;
ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read ai memory" ON public.ai_memory FOR SELECT TO authenticated USING (public.is_active_member(auth.uid()));
CREATE POLICY "members insert ai memory" ON public.ai_memory FOR INSERT TO authenticated WITH CHECK (public.is_active_member(auth.uid()));
CREATE POLICY "members update ai memory" ON public.ai_memory FOR UPDATE TO authenticated USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));
CREATE POLICY "members delete ai memory" ON public.ai_memory FOR DELETE TO authenticated USING (public.is_active_member(auth.uid()));
CREATE INDEX ai_memory_created_idx ON public.ai_memory (created_at DESC);