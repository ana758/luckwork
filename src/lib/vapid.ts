// Public VAPID key — safe to expose in the client bundle.
export const VAPID_PUBLIC_KEY =
  "BMwIx50SbYmmjyCmK4_be2MSkCt0i3uM6JhgllH231BFUyNRJuuWPcqh1HvfOvPiT_2gGGEIR_IFhmeYl3SGNYE";

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
