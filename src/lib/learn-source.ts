import { supabase } from "@/integrations/supabase/client";
import { normalizeTitleKey } from "@/lib/source-rules";
import type { SourceKey } from "@/lib/sources";

/**
 * A IA da Anora aprende: salva a regra "título → empresa" e aplica
 * retroativamente a todos os compromissos e tarefas com o mesmo título.
 */
export async function learnSourceRule(title: string, source: SourceKey) {
  const key = normalizeTitleKey(title);
  if (!key) return;

  await supabase
    .from("source_rules")
    .upsert({ title_key: key, source }, { onConflict: "title_key" });

  // Aplica a regra a itens existentes com o mesmo título.
  await Promise.all([
    supabase.from("meetings").update({ source }).ilike("title", title.trim()),
    supabase.from("tasks").update({ source }).ilike("title", title.trim()),
  ]);
}
