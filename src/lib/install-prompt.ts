type BipEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BipEvent | null = null;
const listeners = new Set<(e: BipEvent | null) => void>();

if (typeof window !== "undefined") {
  // Chrome fires this during page load, before React mounts — capture it here.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BipEvent;
    listeners.forEach((l) => l(deferred));
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l(null));
  });
}

export function onInstallPrompt(cb: (e: BipEvent | null) => void) {
  listeners.add(cb);
  cb(deferred);
  return () => listeners.delete(cb);
}

export async function runInstallPrompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  listeners.forEach((l) => l(null));
  return choice.outcome;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export type { BipEvent };
