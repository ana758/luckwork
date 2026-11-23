CREATE OR REPLACE FUNCTION public.luck_apply_meeting_tombstone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.google_event_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Só esconde cópias que já existiam quando a reunião foi apagada.
  -- Uma reunião nova com o mesmo nome e horário nunca é escondida.
  IF COALESCE(NEW.hidden, false) = false AND EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.hidden = true
      AND m.id IS DISTINCT FROM NEW.id
      AND m.starts_at = NEW.starts_at
      AND public.luck_meeting_title_key(m.title) = public.luck_meeting_title_key(NEW.title)
      AND COALESCE(NEW.created_at, now()) < m.updated_at
      AND TG_OP = 'INSERT' IS NOT TRUE
  ) THEN
    NEW.hidden := true;
  END IF;
  RETURN NEW;
END;
$$;