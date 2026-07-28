DELETE FROM public.meetings
WHERE google_event_id IS NOT NULL
  AND hidden = false
  AND (meeting_type IS NULL OR meeting_type <> 'Reunião')
  AND title !~* 'reuni'
  AND (people IS NULL OR people = '')
  AND (external_url IS NULL OR external_url NOT ILIKE '%meet.google%');