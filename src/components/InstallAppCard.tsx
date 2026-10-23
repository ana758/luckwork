import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Download, Smartphone } from "lucide-react";
import { isStandalone, onInstallPrompt, runInstallPrompt } from "@/lib/install-prompt";

function platformHint(): { title: string; steps: string[] } {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const edge = /Edg\//.test(ua);
  const chrome = /Chrome\//.test(ua) && !edge;

  if (ios) {
    return {
      title: "No iPhone: use o Safari",
      steps: [
        "Abra luckwork.lovable.app no Safari (o Chrome do iPhone não instala apps).",
        "Toque no botão Compartilhar (quadrado com seta para cima).",
        "Escolha “Adicionar à Tela de Início” e depois “Adicionar”.",
      ],
    };
  }
  if (android) {
    return {
      title: "No Android",
      steps: [
        "Abra o site no Chrome.",
        "Toque no menu ⋮ (três pontinhos).",
        "Escolha “Instalar app” ou “Adicionar à tela inicial”.",
      ],
    };
  }
  if (edge) {
    return {
      title: "No Edge",
      steps: [
        "Clique nos três pontinhos no canto superior direito.",
        "Vá em “Apps” → “Instalar este site como app”.",
        "Confirme em “Instalar”.",
      ],
    };
  }
  if (chrome) {
    return {
      title: "No Chrome",
      steps: [
        "Clique no ícone de instalar na barra de endereço (um monitorzinho com seta para baixo).",
        "Ou abra o menu ⋮ → “Salvar e compartilhar” → “Instalar LUCK como app”.",
        "O Chrome cria o ícone e abre o LUCK em janela própria, sem abas.",
      ],
    };
  }
  return {
    title: "Como instalar",
    steps: ["Procure a opção “Instalar” na barra de endereço ou no menu do navegador."],
  };
}

export function InstallAppCard() {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    const off = onInstallPrompt((e) => setCanInstall(!!e));
    return () => {
      off();
    };
  }, []);

  async function install() {
    const outcome = await runInstallPrompt();
    if (outcome === "unavailable") {
      setShowSteps(true);
      return;
    }
    if (outcome === "accepted") {
      setInstalled(true);
      toast.success("Pronto! Abra o LUCK pelo ícone.");
    }
  }

  const hint = platformHint();

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {installed ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">
            {installed ? "LUCK já está instalado" : "Instalar o LUCK como aplicativo"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {installed
              ? "Abra pelo ícone: janela própria, sem abas, e ele se atualiza sozinho."
              : "Abre em janela própria, sem abas nem barra do navegador, e atualiza sozinho. É gratuito."}
          </p>

          {!installed && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={install}
                className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:opacity-90"
              >
                {canInstall ? "Instalar agora" : "Ver como instalar"}
              </button>
              <button
                onClick={() => setShowSteps((v) => !v)}
                className="rounded-md border px-3 py-2 text-xs hover:bg-accent"
              >
                {showSteps ? "Ocultar passos" : "Outro caminho"}
              </button>
            </div>
          )}

          {showSteps && !installed && (
            <div className="mt-3 rounded-lg border bg-background/60 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Smartphone className="h-3.5 w-3.5" />
                {hint.title}
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                {hint.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Em aba anônima o Chrome esconde essa opção — use uma janela normal.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
