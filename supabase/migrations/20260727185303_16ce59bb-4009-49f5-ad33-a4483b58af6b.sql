CREATE OR REPLACE FUNCTION public.luck_meeting_title_key(_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(_title, '')), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.luck_apply_meeting_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.hidden, false) = false AND EXISTS (
    SELECT 1
    FROM public.meetings m
    WHERE m.hidden = true
      AND m.id IS DISTINCT FROM NEW.id
      AND m.starts_at = NEW.starts_at
      AND public.luck_meeting_title_key(m.title) = public.luck_meeting_title_key(NEW.title)
  ) THEN
    NEW.hidden := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.luck_propagate_meeting_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.hidden, false) = true THEN
    UPDATE public.meetings m
    SET hidden = true,
        updated_at = now()
    WHERE m.hidden = false
      AND m.id <> NEW.id
      AND m.starts_at = NEW.starts_at
      AND public.luck_meeting_title_key(m.title) = public.luck_meeting_title_key(NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS luck_apply_meeting_tombstone_before ON public.meetings;
CREATE TRIGGER luck_apply_meeting_tombstone_before
BEFORE INSERT OR UPDATE OF title, starts_at, hidden ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.luck_apply_meeting_tombstone();

DROP TRIGGER IF EXISTS luck_propagate_meeting_tombstone_after ON public.meetings;
CREATE TRIGGER luck_propagate_meeting_tombstone_after
AFTER INSERT OR UPDATE OF title, starts_at, hidden ON public.meetings
FOR EACH ROW
WHEN (NEW.hidden = true)
EXECUTE FUNCTION public.luck_propagate_meeting_tombstone();