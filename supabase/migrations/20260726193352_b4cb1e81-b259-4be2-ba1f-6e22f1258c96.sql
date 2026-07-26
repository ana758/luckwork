ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS meetings_hidden_idx ON public.meetings (hidden);