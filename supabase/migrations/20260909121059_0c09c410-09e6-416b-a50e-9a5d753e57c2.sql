UPDATE public.meetings
SET hidden = true,
    updated_at = now()
WHERE public.luck_meeting_title_key(title) IN (
  'reuniao canoa',
  'reuniao bruna',
  'reuniao comite dont eat'
);