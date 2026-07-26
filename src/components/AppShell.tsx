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
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-4 md:px-6">
        {/* Desktop nav */}
        <aside className="sticky top-4 hidden h-fit w-52 shrink-0 md:block">
          <div className="mb-6 px-2">
            <p className="text-sm font-semibold tracking-tight">Meu Hub</p>
            <p className="text-xs text-muted-foreground">Angi · Devore · Bruna · Pessoal</p>
          </div>
          <nav className="space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.to;
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
                  {item.label}
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
          <Outlet />
        </main>
      </div>

      {/* Mobile nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card/95 backdrop-blur md:hidden">
        {NAV.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <QuickAdd />
    </div>
  );
}
