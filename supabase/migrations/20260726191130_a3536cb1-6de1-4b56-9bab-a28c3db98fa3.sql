ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS google_event_id text,
  ADD COLUMN IF NOT EXISTS google_account text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS meetings_google_event_uniq
  ON public.meetings (google_account, google_event_id)
  WHERE google_event_id IS NOT NULL;