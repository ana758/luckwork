/** Som de notificação in-app (bipe curto via WebAudio) + vibração no celular. */
let ctx: AudioContext | null = null;

export function playNotificationSound() {
  try {
    const AC = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);

    // dois tons curtos (ding-dong)
    [
      { f: 880, t: 0 },
      { f: 1245, t: 0.18 },
    ].forEach(({ f, t }) => {
      const osc = ctx!.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now + t);
      osc.connect(gain);
      gain.gain.exponentialRampToValueAtTime(0.25, now + t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
      osc.start(now + t);
      osc.stop(now + t + 0.18);
    });
  } catch {
    /* ignora */
  }

  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* ignora */
  }
}

/** Destrava o áudio após o primeiro gesto do usuário (política dos navegadores). */
export function primeNotificationSound() {
  const unlock = () => {
    try {
      const AC = (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as
        | typeof AudioContext
        | undefined;
      if (AC && !ctx) ctx = new AC();
      ctx?.resume().catch(() => {});
    } catch {
      /* ignora */
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}
