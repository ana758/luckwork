
CREATE OR REPLACE FUNCTION public.luck_apply_meeting_tombstone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só aplica "tombstone" para eventos importados do Google.
  IF NEW.google_event_id IS NULL THEN
    RETURN NEW;
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.luck_propagate_meeting_tombstone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.hidden, false) = true THEN
    UPDATE public.meetings m
    SET hidden = true,
        updated_at = now()
    WHERE m.hidden = false
      AND m.id <> NEW.id
      AND m.google_event_id IS NOT NULL
      AND m.starts_at = NEW.starts_at
      AND public.luck_meeting_title_key(m.title) = public.luck_meeting_title_key(NEW.title);
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.meetings
SET hidden = false
WHERE hidden = true
  AND google_event_id IS NULL
  AND created_at > now() - interval '1 day'
  AND public.luck_meeting_title_key(title) = 'reuniao angi';
