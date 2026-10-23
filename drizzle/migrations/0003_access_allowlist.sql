CREATE TABLE public.access_allowlist (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.access_allowlist TO authenticated;
GRANT ALL ON public.access_allowlist TO service_role;
ALTER TABLE public.access_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners read allowlist" ON public.access_allowlist FOR SELECT TO authenticated USING (private.is_owner(auth.uid()));
CREATE POLICY "owners add allowlist" ON public.access_allowlist FOR INSERT TO authenticated WITH CHECK (private.is_owner(auth.uid()));
CREATE POLICY "owners remove allowlist" ON public.access_allowlist FOR DELETE TO authenticated USING (private.is_owner(auth.uid()));

INSERT INTO public.access_allowlist(email) VALUES
('ana@devoresnacks.com'),('anaduquek@gmail.com'),('drabiazinha@gmail.com'),('ana@angisaude.com'),('4r1t2a@mail.instinct.com'),('biduque@hotmail.com')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.workspace_members (user_id, email, status)
  VALUES (NEW.id, COALESCE(NEW.email,''),
    CASE WHEN EXISTS (SELECT 1 FROM public.access_allowlist a WHERE a.email = lower(COALESCE(NEW.email,'')))
      THEN 'active'::public.member_status ELSE 'pending'::public.member_status END)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.access_allowlist_activate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  UPDATE public.workspace_members SET status='active' WHERE lower(email)=NEW.email;
  RETURN NEW;
END; $$;
CREATE TRIGGER access_allowlist_activate BEFORE INSERT ON public.access_allowlist FOR EACH ROW EXECUTE FUNCTION public.access_allowlist_activate();

UPDATE public.workspace_members SET status='active' WHERE lower(email) IN (SELECT email FROM public.access_allowlist);