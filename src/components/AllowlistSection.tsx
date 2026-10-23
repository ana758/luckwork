import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function AllowlistSection() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const { data: list = [] } = useQuery({
    queryKey: ["access_allowlist"],
    queryFn: async () => {
      const { data, error } = await supabase.from("access_allowlist").select("email").order("email");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["access_allowlist"] });
    qc.invalidateQueries({ queryKey: ["workspace_members"] });
  };
  const add = useMutation({
    mutationFn: async () => {
      const e = email.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error("E-mail inválido");
      const { error } = await supabase.from("access_allowlist").insert({ email: e });
      if (error) throw new Error(error.code === "23505" ? "Esse e-mail já tem acesso" : error.message);
    },
    onSuccess: () => {
      toast.success("Acesso liberado");
      setEmail("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (e: string) => {
      const { error } = await supabase.from("access_allowlist").delete().eq("email", e);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Removido da lista");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-medium">Quem tem acesso</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        E-mails desta lista entram direto, sem precisar de aprovação.
      </p>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          add.mutate();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          type="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="email@exemplo.com"
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <button disabled={add.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
          Adicionar
        </button>
      </form>
      <ul className="mt-3 space-y-2">
        {list.map((r) => (
          <li key={r.email} className="flex items-center gap-2 text-sm">
            <span className="truncate">{r.email}</span>
            <button
              onClick={() => {
                if (confirm(`Remover ${r.email} da lista?`)) remove.mutate(r.email);
              }}
              className="ml-auto rounded-md border px-2 py-1 text-xs text-destructive hover:bg-accent"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
