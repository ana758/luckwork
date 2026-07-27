import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "./vapid";
import { registerPushSubscription } from "./push.functions";

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === "undefined") return { ok: false, reason: "server" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };

  const reg = await navigator.serviceWorker.register("/sw-push.js", { scope: "/" });
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
