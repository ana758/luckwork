DROP TRIGGER IF EXISTS luck_meetings_apply_tombstone ON public.meetings;
CREATE TRIGGER luck_meetings_apply_tombstone
BEFORE INSERT OR UPDATE
ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.luck_apply_meeting_tombstone();

DROP TRIGGER IF EXISTS luck_meetings_propagate_tombstone ON public.meetings;
CREATE TRIGGER luck_meetings_propagate_tombstone
AFTER INSERT OR UPDATE OF hidden
ON public.meetings
FOR EACH ROW
WHEN (NEW.hidden = true)
EXECUTE FUNCTION public.luck_propagate_meeting_tombstone();