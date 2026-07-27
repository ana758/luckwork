import { useCallback, useEffect, useState } from "react";
import { SOURCES, type SourceKey } from "./sources";

const KEY = "luck:archived-sources";

function read(): SourceKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SourceKey[]) : [];
  } catch {
    return [];
  }
}

function write(next: SourceKey[]) {
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("luck:archived-sources-changed"));
}

export function useArchivedSources() {
  const [archived, setArchived] = useState<SourceKey[]>([]);

  useEffect(() => {
    setArchived(read());
    const onChange = () => setArchived(read());
    window.addEventListener("luck:archived-sources-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("luck:archived-sources-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const archive = useCallback((key: SourceKey) => {
    const next = Array.from(new Set([...read(), key]));
    write(next);
  }, []);

  const unarchive = useCallback((key: SourceKey) => {
    const next = read().filter((k) => k !== key);
    write(next);
  }, []);

  const isArchived = useCallback((key: SourceKey) => archived.includes(key), [archived]);

  const visibleSources = SOURCES.filter((s) => !archived.includes(s.key));

  return { archived, archive, unarchive, isArchived, visibleSources };
}
