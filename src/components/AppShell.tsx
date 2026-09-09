import { Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { QuickAdd } from "./QuickAdd";
import { NotificationsBell } from "./NotificationsBell";
import { NotifPermissionButton } from "./NotifPermissionButton";
import { AiPanel } from "./AiPanel";
import { useAutoSyncGoogle } from "@/hooks/useAutoSyncGoogle";
import { useOverdueScan } from "@/hooks/useOverdueScan";
import { useDesktopReminders } from "@/lib/desktop-notify";


const NAV = [
  { to: "/", label: "Início", icon: LayoutDashboard },
  { to: "/tarefas", label: "Tarefas", icon: ListTodo },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/reunioes", label: "Reuniões", icon: Users },
  { to: "/ai", label: "IA", icon: Sparkles },
  { to: "/configuracoes", label: "Ajustes", icon: Settings },
] as const;

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: membership, isLoading } = useQuery({
    queryKey: ["membership"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from("workspace_members")
        .select("status, email")
        .eq("user_id", uid)
        .maybeSingle();
      return data;
    },
  });

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["workspace_members", "pending_count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
    enabled: membership?.status === "active",
    refetchInterval: 60_000,
  });

  useAutoSyncGoogle();
  useOverdueScan();
  useDesktopReminders();

  // Deixa Tarefas, Calendário e Reuniões já carregados em memória:
  // trocar de página passa a ser instantâneo.
  useEffect(() => {
    if (membership?.status !== "active") return;
    void queryClient.prefetchQuery({
      queryKey: ["tasks"],
      queryFn: async () => {
        const { data } = await supabase
          .from("tasks")
          .select("*")
          .order("due_date", { ascending: true, nullsFirst: false });
        return data ?? [];
      },
    });
    void queryClient.prefetchQuery({
      queryKey: ["meetings"],
      queryFn: async () => {
        const { data } = await supabase
          .from("meetings")
          .select("*")
          .order("starts_at", { ascending: true });
        return data ?? [];
      },
    });
  }, [membership?.status, queryClient]);



  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (membership && membership.status !== "active") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm rounded-xl border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">Aguardando liberação</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A conta {membership.email} ainda não foi aprovada. Libere este e-mail em Ajustes →
            Acessos usando uma conta já aprovada.
          </p>
          <button
            onClick={signOut}
            className="mt-4 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-36 md:pb-0">

      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-4 md:px-6">
        {/* Desktop nav */}
        <aside className="sticky top-4 hidden h-fit w-52 shrink-0 md:block">
          <div className="mb-6 px-2">
            <p className="text-lg font-semibold tracking-tight">LUCK</p>
            <p className="text-xs text-muted-foreground">Angi · Devore · Brand.Pe · Pessoal</p>
          </div>
          <nav className="space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.to;
              const showBadge = item.to === "/configuracoes" && pendingCount > 0;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {showBadge && (
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={signOut}
            className="mt-6 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="mb-4 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground md:hidden">
              LUCK
            </p>
            <div className="ml-auto flex items-center gap-2">
              <AiPanel />
              <NotifPermissionButton />
              <NotificationsBell />
            </div>
          </header>

          <Outlet />
        </main>
      </div>

      {/* Mobile nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2.25rem)" }}
      >

        {NAV.map((item) => {
          const active = pathname === item.to;
          const showBadge = item.to === "/configuracoes" && pendingCount > 0;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-3 text-[12px] font-medium ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-6 w-6" />
              <span>{item.label}</span>
              {showBadge && (
                <span className="absolute right-2 top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <QuickAdd />
    </div>
  );
}
