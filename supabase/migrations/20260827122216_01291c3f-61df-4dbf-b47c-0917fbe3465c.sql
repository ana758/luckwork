ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS is_meeting boolean NOT NULL DEFAULT true;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS mirror_event_id text;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS mirror_account text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS mirror_event_id text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS mirror_account text;