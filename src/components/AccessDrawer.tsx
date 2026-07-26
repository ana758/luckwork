import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAccessEntries } from "@/lib/queries";
import { SOURCE_LABEL, type SourceKey } from "@/lib/sources";
import { revealAccessPassword, saveAccessPassword } from "@/lib/vault.functions";

export function AccessDrawer({ source, onClose }: { source: SourceKey; onClose: () => void }) {
  const { data: entries = [] } = useAccessEntries();
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ label: "", url: "", login: "", password: "" });
  const [adding, setAdding] = useState(false);

  const list = entries.filter((e) => e.source === source);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.label.trim()) throw new Error("Dê um nome para o acesso.");
      const { data, error } = await supabase
        .from("access_entries")
        .insert({
          source,
          label: form.label.trim(),
          url: form.url.trim() || null,
          login: form.login.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      if (form.password) {
        await saveAccessPassword({ data: { id: data.id, password: form.password } });
      }
    },
    onSuccess: () => {
      toast.success("Acesso salvo");
      setForm({ label: "", url: "", login: "", password: "" });
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ["access_entries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function reveal(id: string) {
    try {
      const res = await revealAccessPassword({ data: { id } });
      setRevealed((r) => ({ ...r, [id]: res.password || "—" }));
    } catch {
      toast.error("Não foi possível mostrar a senha.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={onClose}>
      <div
        className="h-full w-full max-w-sm overflow-y-auto border-l bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Acessos · {SOURCE_LABEL[source]}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {list.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum acesso guardado ainda.</p>
          )}
          {list.map((entry) => (
            <div key={entry.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{entry.label}</p>
                {entry.url && (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground underline"
                  >
                    abrir
                  </a>
                )}
              </div>
              {entry.login && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{entry.login}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(entry.login!);
                      toast.success("Login copiado");
                    }}
                    aria-label="Copiar login"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                {revealed[entry.id] ? (
                  <>
                    <span className="truncate font-mono">{revealed[entry.id]}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(revealed[entry.id]);
                        toast.success("Senha copiada");
                      }}
                      aria-label="Copiar senha"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => reveal(entry.id)}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    <Eye className="h-3 w-3" /> mostrar senha
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="mt-4 space-y-2 rounded-lg border p-3">
            {(["label", "url", "login", "password"] as const).map((field) => (
              <input
                key={field}
                type={field === "password" ? "password" : "text"}
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                placeholder={
                  field === "label"
                    ? "Nome (ex.: CRM Angi)"
                    : field === "url"
                      ? "https://…"
                      : field === "login"
                        ? "Login"
                        : "Senha"
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            ))}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAdding(false)}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              >
                Cancelar
              </button>
              <button
                onClick={() => create.mutate()}
                disabled={create.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
              >
                Salvar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-4 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-xs text-muted-foreground hover:bg-accent"
          >
            <Plus className="h-3 w-3" /> Adicionar acesso
          </button>
        )}

        <p className="mt-4 text-[11px] text-muted-foreground">
          As senhas ficam criptografadas no servidor e só são exibidas quando você pede.
        </p>
      </div>
    </div>
  );
}
