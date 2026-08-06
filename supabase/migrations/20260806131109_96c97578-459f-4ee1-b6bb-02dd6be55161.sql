CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.workspace_members (user_id, email, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    CASE WHEN lower(COALESCE(NEW.email,'')) IN ('ana@devoresnacks.com','anaduquek@gmail.com','drabiazinha@gmail.com','ana@angisaude.com')
      THEN 'active'::public.member_status ELSE 'pending'::public.member_status END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

UPDATE public.workspace_members SET status = 'active'::public.member_status
WHERE lower(email) = 'ana@angisaude.com';