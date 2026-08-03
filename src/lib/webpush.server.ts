import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string | null;
  url?: string | null;
  tag?: string | null;
}

/** Sends standards-compliant encrypted Web Push, including Apple Web Push. */
export async function sendPush(sub: PushSubscriptionRecord, payload: PushPayload): Promise<number> {
  const vapid: VapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || "mailto:noreply@luckwork.app",
  };
  if (!vapid.publicKey || !vapid.privateKey) throw new Error("VAPID keys missing");
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  const request = await buildPushPayload(
    { data: JSON.stringify(payload), options: { ttl: 86_400, urgency: "high" } },
    subscription,
    vapid,
  );
  const body = request.body.buffer.slice(
    request.body.byteOffset,
    request.body.byteOffset + request.body.byteLength,
  ) as ArrayBuffer;
  const res = await fetch(subscription.endpoint, { ...request, body });
  return res.status;
}

/** Legacy wake-up push (no payload). Kept for compatibility. */
export async function sendWakeupPush(sub: PushSubscriptionRecord): Promise<number> {
  return sendPush(sub, { title: "LUCK", body: "Você tem novas atualizações", url: "/" });
}
