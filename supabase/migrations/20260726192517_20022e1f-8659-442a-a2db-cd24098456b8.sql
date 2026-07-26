GRANT EXECUTE ON FUNCTION public.is_active_member(uuid) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_user_id_unique
  ON public.workspace_members (user_id);

DROP INDEX IF EXISTS public.meetings_google_unique;
DROP INDEX IF EXISTS public.meetings_google_event_unique;

CREATE UNIQUE INDEX IF NOT EXISTS meetings_google_account_event_unique
  ON public.meetings (google_account, google_event_id);