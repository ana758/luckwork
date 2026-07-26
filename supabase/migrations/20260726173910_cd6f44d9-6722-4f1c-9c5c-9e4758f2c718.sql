CREATE TYPE public.source_key AS ENUM ('angi','devore','bruna','pessoal');
CREATE TYPE public.task_status AS ENUM ('todo','doing','onhold','done');
CREATE TYPE public.task_priority AS ENUM ('alta','media','baixa');
CREATE TYPE public.recurrence_kind AS ENUM ('none','daily','weekly','monthly');
CREATE TYPE public.member_status AS ENUM ('active','pending');

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  status public.member_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_member(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = _user_id AND status = 'active');
$$;

CREATE POLICY "member reads own row" ON public.workspace_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_active_member(auth.uid()));
CREATE POLICY "active members manage members" ON public.workspace_members
  FOR UPDATE TO authenticated USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));
CREATE POLICY "active members delete members" ON public.workspace_members
  FOR DELETE TO authenticated USING (public.is_active_member(auth.uid()));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.workspace_members (user_id, email, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    CASE WHEN lower(COALESCE(NEW.email,'')) IN ('ana@devoresnacks.com','anaduquek@gmail.com')
      THEN 'active'::public.member_status ELSE 'pending'::public.member_status END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  notes text,
  source public.source_key NOT NULL DEFAULT 'pessoal',
  status public.task_status NOT NULL DEFAULT 'todo',
  priority public.task_priority NOT NULL DEFAULT 'media',
  start_date date,
  due_date date,
  recurrence public.recurrence_kind NOT NULL DEFAULT 'none',
  external_system text,
  external_url text,
  external_id text,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage tasks" ON public.tasks FOR ALL TO authenticated
  USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));
CREATE TRIGGER tasks_touch BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source public.source_key NOT NULL DEFAULT 'pessoal',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  meeting_type text,
  people text,
  notes text,
  external_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage meetings" ON public.meetings FOR ALL TO authenticated
  USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));
CREATE TRIGGER meetings_touch BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.access_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source public.source_key NOT NULL,
  label text NOT NULL,
  url text,
  login text,
  password_ciphertext text,
  is_connected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_entries TO authenticated;
GRANT ALL ON public.access_entries TO service_role;
ALTER TABLE public.access_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage access" ON public.access_entries FOR ALL TO authenticated
  USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));
CREATE TRIGGER access_touch BEFORE UPDATE ON public.access_entries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  provider text NOT NULL DEFAULT 'google',
  source public.source_key NOT NULL DEFAULT 'pessoal',
  is_connected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_accounts TO authenticated;
GRANT ALL ON public.email_accounts TO service_role;
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage email accounts" ON public.email_accounts FOR ALL TO authenticated
  USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage notifications" ON public.notifications FOR ALL TO authenticated
  USING (public.is_active_member(auth.uid())) WITH CHECK (public.is_active_member(auth.uid()));

INSERT INTO public.access_entries (source, label, url) VALUES
  ('angi','Jira','https://www.atlassian.com/software/jira'),
  ('angi','CRM Angi','https://crm.angisaude.com/'),
  ('devore','Notion','https://www.notion.so/'),
  ('devore','E-mail Devore','https://mail.google.com/'),
  ('bruna','Google Agenda','https://calendar.google.com/'),
  ('pessoal','Google Agenda','https://calendar.google.com/');

INSERT INTO public.email_accounts (email, provider, source) VALUES
  ('ana@devoresnacks.com','google','devore'),
  ('anaduquek@gmail.com','google','pessoal'),
  ('biduque@hotmail.com','microsoft','pessoal');