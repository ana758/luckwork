
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage push_subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));

CREATE TABLE IF NOT EXISTS public.sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL,
  imported int DEFAULT 0,
  pushed int DEFAULT 0,
  error text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sync_log TO authenticated;
GRANT ALL ON public.sync_log TO service_role;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sync_log"
  ON public.sync_log FOR SELECT TO authenticated
  USING (private.is_active_member(auth.uid()));
CREATE POLICY "members insert sync_log"
  ON public.sync_log FOR INSERT TO authenticated
  WITH CHECK (private.is_active_member(auth.uid()));
CREATE INDEX IF NOT EXISTS sync_log_created_idx ON public.sync_log (created_at DESC);

CREATE TABLE IF NOT EXISTS public.pending_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  url text,
  tag text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.pending_pushes TO authenticated;
GRANT ALL ON public.pending_pushes TO service_role;
ALTER TABLE public.pending_pushes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage pending_pushes"
  ON public.pending_pushes FOR ALL TO authenticated
  USING (private.is_active_member(auth.uid()))
  WITH CHECK (private.is_active_member(auth.uid()));
CREATE INDEX IF NOT EXISTS pending_pushes_pending_idx ON public.pending_pushes (created_at) WHERE delivered_at IS NULL;

-- Cleanup old records (keep 30 days of sync_log, 7 days of delivered pushes)
CREATE OR REPLACE FUNCTION public.cleanup_old_logs() RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.sync_log WHERE created_at < now() - interval '30 days';
  DELETE FROM public.pending_pushes WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '7 days';
$$;
