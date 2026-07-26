
CREATE OR REPLACE FUNCTION public.notify_pending_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.notifications (title, body)
    VALUES ('Novo pedido de acesso', NEW.email || ' pediu para entrar. Aprove em Ajustes.');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_pending_member_notify ON public.workspace_members;
CREATE TRIGGER on_pending_member_notify
AFTER INSERT ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION public.notify_pending_member();
