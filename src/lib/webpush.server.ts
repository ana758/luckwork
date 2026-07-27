/**
 * Minimal Web Push server helper for Cloudflare Workers.
 * Sends "wake-up" pushes (no payload) with VAPID auth.
 * The service worker fetches pending notifications on receipt.
 */

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function importVapidKey(privateD: string, publicRaw: Uint8Array): Promise<CryptoKey> {
  // publicRaw is 65 bytes: 0x04 || X(32) || Y(32)
  if (publicRaw.length !== 65 || publicRaw[0] !== 0x04) throw new Error("bad vapid public key");
  const x = b64urlEncode(publicRaw.slice(1, 33));
  const y = b64urlEncode(publicRaw.slice(33, 65));
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", d: privateD, x, y, ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signVapidJwt(audience: string, subject: string, publicKey: string, privateKey: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  };
  const enc = new TextEncoder();
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const unsigned = `${h}.${p}`;
  const pubRaw = b64urlDecode(publicKey);
  const key = await importVapidKey(privateKey, pubRaw);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `${unsigned}.${b64urlEncode(sig)}`;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends a wake-up push (no payload). Returns HTTP status. */
export async function sendWakeupPush(sub: PushSubscriptionRecord): Promise<number> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@anora.app";
  if (!publicKey || !privateKey) throw new Error("VAPID keys missing");

  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await signVapidJwt(audience, subject, publicKey, privateKey);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      TTL: "300",
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
      "Content-Length": "0",
    },
  });
  return res.status;
}
