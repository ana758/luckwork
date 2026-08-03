import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "./vapid";
import { registerPushSubscription, sendTestPushToDevice, cleanupOldSubscriptions } from "./push.functions";

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === "undefined") return { ok: false, reason: "server" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };

  const reg = await navigator.serviceWorker.register("/sw-push.js", { scope: "/", updateViaCache: "none" });
  await reg.update();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    });
  }


  const json = sub.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  await registerPushSubscription({
    data: {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      userAgent: navigator.userAgent,
    },
  });

  return { ok: true };
}

export async function isPushEnabled(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function refreshPushSubscription(): Promise<boolean> {
  if (!(await isPushEnabled())) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!reg || !sub) return false;
  await reg.update();
  const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.keys?.p256dh || !json.keys.auth) return false;
  await registerPushSubscription({
    data: {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      userAgent: navigator.userAgent,
    },
  });
  return true;
}

/** Recria a assinatura do zero (corrige assinaturas antigas/inválidas) e devolve o endpoint. */
export async function resubscribePush(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return null;

  const reg = await navigator.serviceWorker.register("/sw-push.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await reg.update();
  await navigator.serviceWorker.ready;

  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe().catch(() => false);

  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
  });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };

  await registerPushSubscription({
    data: {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      userAgent: navigator.userAgent,
    },
  });
  await cleanupOldSubscriptions({
    data: { endpoint: json.endpoint, userAgent: navigator.userAgent },
  }).catch(() => null);

  return json.endpoint;
}

/** Recria a assinatura e dispara um push de teste só para este aparelho. */
export async function testPushHere(): Promise<{ ok: boolean; status?: number; reason?: string }> {
  const endpoint = await resubscribePush();
  if (!endpoint) return { ok: false, reason: "denied" };
  try {
    const r = await sendTestPushToDevice({ data: { endpoint } });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "erro" };
  }
}
