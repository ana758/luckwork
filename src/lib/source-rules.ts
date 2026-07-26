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
