import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AccessDrawer } from "@/components/AccessDrawer";
import { AllowlistSection } from "@/components/AllowlistSection";
import { SOURCES, SOURCE_DOT, type SourceKey } from "@/lib/sources";
import { useArchivedSources } from "@/lib/archived-sources";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Ajustes · LUCK" },
      {
        name: "description",
        content: "Aprove e-mails de acesso, cadastre caixas de e-mail e gerencie seus acessos.",
      },
      { property: "og:title", content: "Ajustes · LUCK" },
      { property: "og:description", content: "Acessos, e-mails e permissões do seu hub." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const [drawer, setDrawer] = useState<SourceKey | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const { archived, archive, unarchive, isArchived } = useArchivedSources();

  const { data: members = [] } = useQuery({
    queryKey: ["workspace_members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("id, email, status")
        .order("email");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: mailboxes = [] } = useQuery({
    queryKey: ["email_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_accounts")
        .select("id, email, provider")
        .order("email");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: mailStatus, isLoading: mailLoading } = useQuery({
    queryKey: ["mail_integration_status"],
    queryFn: async () => {
      const { getMailIntegrationStatus } = await import("@/lib/integration-status.functions");
      return getMailIntegrationStatus();
    },
    staleTime: 60_000,
    retry: false,
  });

  function stateOf(m: { email: string; provider: string }) {
    if (mailLoading) return { label: "Verificando…", tone: "muted", next: "" } as const;
    if (!mailStatus) return { label: "Sem resposta", tone: "red", next: "Não consegui consultar as conexões agora. Tente de novo em instantes." } as const;
    const email = m.email.toLowerCase();
    if (m.provider === "outlook") {
      const o = mailStatus.outlook;
      if (!o.configured) return { label: "Cadastrado", tone: "muted", next: "Falta conectar o Outlook em Connectors no Lovable." } as const;
      if (o.state === "connected" && (!o.email || o.email === email))
        return { label: "Conectado", tone: "green", next: "" } as const;
      if (o.state === "connected")
        return { label: "Cadastrado", tone: "muted", next: `O Outlook conectado é ${o.email}, não esta conta.` } as const;
      if (o.state === "reconnect")
        return { label: "Precisa reconectar", tone: "amber", next: "Reconecte o Outlook em Connectors no Lovable." } as const;
      return { label: "Erro", tone: "red", next: o.detail ?? "Falha ao consultar o Outlook." } as const;
    }
    const g = mailStatus.gmail.find((x) => x.email === email);
    if (g?.state === "connected")
      return g.excluded
        ? ({ label: "Conectado", tone: "green", next: "Conectado, mas a LUCK não lê esse e-mail de propósito." } as const)
        : ({ label: "Conectado", tone: "green", next: "" } as const);
    if (mailStatus.gmail.some((x) => x.state === "reconnect"))
      return { label: "Precisa reconectar", tone: "amber", next: "Reconecte o Gmail em Connectors no Lovable." } as const;
    if (mailStatus.gmail.some((x) => x.state === "error"))
      return { label: "Erro", tone: "red", next: "O Gmail respondeu com erro. Tente reconectar em Connectors no Lovable." } as const;
    return { label: "Cadastrado", tone: "muted", next: "Falta conectar este Gmail em Connectors no Lovable." } as const;
  }

  const approve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "pending" }) => {
      const { error } = await supabase.from("workspace_members").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Atualizado");
      queryClient.invalidateQueries({ queryKey: ["workspace_members"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspace_members").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Pedido recusado");
      queryClient.invalidateQueries({ queryKey: ["workspace_members"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = members.filter((m) => m.status !== "active");
  const active = members.filter((m) => m.status === "active");

  const addMailbox = useMutation({
    mutationFn: async () => {
      const email = newEmail.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");
      const provider = email.includes("hotmail") || email.includes("outlook")
        ? "outlook"
        : "google";
      const { error } = await supabase.from("email_accounts").insert({ email, provider });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Caixa adicionada");
      setNewEmail("");
      queryClient.invalidateQueries({ queryKey: ["email_accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
      </header>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">
          Pedidos de acesso
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-[11px] text-destructive-foreground">
              {pending.length}
            </span>
          )}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Quem pedir para entrar aparece aqui. Aprove ou recuse.
        </p>
        {pending.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Nenhum pedido pendente.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pending.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className="truncate">{m.email}</span>
                <button
                  onClick={() => approve.mutate({ id: m.id, status: "active" })}
                  className="ml-auto rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Recusar o acesso de ${m.email}?`)) reject.mutate(m.id);
                  }}
                  className="rounded-md border px-3 py-1 text-xs text-destructive hover:bg-accent"
                >
                  Recusar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AllowlistSection />

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Quem já entrou</h2>
        <ul className="mt-3 space-y-2">
          {active.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className="truncate">{m.email}</span>
              <button
                onClick={() => approve.mutate({ id: m.id, status: "pending" })}
                className="ml-auto rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                Suspender
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Caixas de e-mail para a IA ler</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cadastrar não conecta. O estado de cada caixa vem da conexão real, não do cadastro.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {mailboxes.map((m) => {
            const st = stateOf(m);
            const color =
              st.tone === "green"
                ? "bg-emerald-100 text-emerald-800"
                : st.tone === "amber"
                  ? "bg-amber-100 text-amber-800"
                  : st.tone === "red"
                    ? "bg-red-100 text-red-800"
                    : "bg-secondary text-muted-foreground";
            return (
              <li key={m.id}>
                <div className="flex items-center gap-2">
                  <span className="truncate">{m.email}</span>
                  <span className="text-xs text-muted-foreground">{m.provider === "outlook" ? "Outlook" : "Gmail"}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
                    {st.label}
                  </span>
                </div>
                {st.next && <p className="mt-0.5 text-[11px] text-muted-foreground">{st.next}</p>}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="outro@email.com"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => addMailbox.mutate()}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            Adicionar
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Acessos e senhas</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setDrawer(s.key)}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
            >
              <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[s.key]}`} />
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Empresas no CRM</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Arquivadas somem do painel, tarefas e calendário — mas ficam aqui para desarquivar.
        </p>
        <ul className="mt-3 space-y-2">
          {SOURCES.map((s) => {
            const arch = isArchived(s.key);
            return (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${SOURCE_DOT[s.key]}`} />
                <span className={arch ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {arch ? "arquivada" : "ativa"}
                </span>
                <button
                  onClick={() => (arch ? unarchive(s.key) : archive(s.key))}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  {arch ? "Desarquivar" : "Arquivar"}
                </button>
              </li>
            );
          })}
        </ul>
        {archived.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {archived.length} arquivada(s).
          </p>
        )}
      </section>

      <SyncStatusSection />

      {drawer && <AccessDrawer source={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function SyncStatusSection() {
  const { data: logs = [] } = useQuery({
    queryKey: ["sync_log"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sync_log")
        .select("id, source, status, imported, pushed, error, duration_ms, created_at")
        .order("created_at", { ascending: false })
        .limit(15);
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const bySource = new Map<string, (typeof logs)[number]>();
  for (const l of logs) if (!bySource.has(l.source)) bySource.set(l.source, l);

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Status das sincronizações</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        O servidor sincroniza Jira, Notion e Google Agenda a cada 5 minutos, mesmo com o app fechado.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {["jira", "notion", "gcal"].map((src) => {
          const last = bySource.get(src);
          const ok = last?.status === "ok";
          return (
            <div key={src} className="rounded-md border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize">
                  {src === "gcal" ? "Google Agenda" : src}
                </span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    !last ? "bg-muted-foreground/30" : ok ? "bg-emerald-500" : "bg-red-500"
                  }`}
                />
              </div>
              {last ? (
                <div className="mt-1 space-y-0.5 text-muted-foreground">
                  <div>{new Date(last.created_at).toLocaleString("pt-BR")}</div>
                  {ok ? (
                    <div>
                      {last.imported ?? 0} recebidas · {last.pushed ?? 0} enviadas
                    </div>
                  ) : (
                    <div className="text-red-600 truncate" title={last.error ?? undefined}>
                      {last.error}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-muted-foreground">Sem execuções ainda.</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

