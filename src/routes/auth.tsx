import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import luckHand from "@/assets/luck-hand.jpg";
import { oauthReturnPath } from "@/lib/oauth-return-path";


export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ next: s.next === undefined ? undefined : oauthReturnPath(s.next) } as { next?: string }),
  head: () => ({
    meta: [
      { title: "Entrar · LUCK" },
      { name: "description", content: "Acesse seu hub de tarefas, reuniões e agenda das suas empresas." },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Entrar · LUCK" },
      { property: "og:description", content: "Acesse seu hub de tarefas, reuniões e agenda." },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Entrar · LUCK" },
      { name: "twitter:description", content: "Acesse seu hub de tarefas, reuniões e agenda." },
    ],
  }),
  component: AuthPage,
});

function isIosStandalonePwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const isIos =
    /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (/Macintosh/.test(window.navigator.userAgent) && window.navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  return isIos && isStandalone;
}

function redirectToGoogleLogin(back: string) {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const state = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const params = new URLSearchParams({
    provider: "google",
    redirect_uri: back,
    state,
  });
  window.location.assign(`/~oauth/initiate?${params.toString()}`);
}

function AuthPage() {
  const navigate = useNavigate();
  const next = Route.useSearch().next ?? "/";
  const back = next !== "/" ? `${window.location.origin}/auth?next=${encodeURIComponent(next)}` : `${window.location.origin}/auth`;
  const go = () => (next !== "/" ? window.location.assign(next) : navigate({ to: "/", replace: true }));
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) go();
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) go();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: new URL(next, window.location.origin).href },
        });
        if (error) throw error;
      }
      go();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  async function google() {
    setLoading(true);
    if (isIosStandalonePwa()) {
      redirectToGoogleLogin(back);
      return;
    }

    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: back,
    });
    if (result.error) {
      toast.error("Não foi possível entrar com o Google.");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    go();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm">
        <img
          src={luckHand}
          alt="LUCK"
          width={768}
          height={1024}
          className="mx-auto mb-4 h-32 w-auto rounded-lg object-contain"
        />
        <h1 className="text-center text-3xl font-semibold tracking-tight">LUCK</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Tarefas, agenda e reuniões da Angi, Devore, Brand.Pe e Pessoal em um lugar só.
        </p>


        <button
          onClick={google}
          disabled={loading}
          className="mt-6 w-full rounded-md border bg-card px-3 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          Entrar com Google
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          No app instalado no iPhone, o Google abre em tela inteira para o teclado funcionar melhor.
        </p>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            className="w-full rounded-md border bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            className="w-full rounded-md border bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "login" ? "Primeira vez? Criar conta" : "Já tenho conta — entrar"}
        </button>
      </div>
    </main>
  );
}
