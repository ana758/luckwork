REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_active_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_member(uuid) TO authenticated;