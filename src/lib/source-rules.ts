import type { SourceKey } from "./sources";

/** Normaliza o título para servir de chave de regra (case/acentos/espacos). */
export function normalizeTitleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export type SourceRule = { title_key: string; source: SourceKey };

/**
 * Detecta menção explícita de empresa no título (ex.: "Reunião Angi", "pagar devore").
 * Retorna a SourceKey correspondente ou null. Usado pela IA da Anora para
 * reclassificar automaticamente itens quando o nome da empresa aparece no título.
 */
export function inferSourceFromTitle(title: string): SourceKey | null {
  const t = normalizeTitleKey(title);
  if (!t) return null;
  const has = (kw: string) => new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`).test(t);
  if (has("angi")) return "angi";
  if (has("devore") || has("devoresnacks") || has("snacks")) return "devore";
  if (has("bruna") || has("bergamini") || has("branding pessoal")) return "bruna";
  if (has("pessoal")) return "pessoal";
  return null;
}
