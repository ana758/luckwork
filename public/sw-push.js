/* LUCK Web Push service worker */
const CACHE = "luck-push-v1";

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = null;
      try {
        if (event.data) payload = event.data.json();
      } catch {}

      // Wake-up push (no payload): fetch pending
      if (!payload) {
        try {
          const res = await fetch("/api/public/hooks/pending-pushes", { cache: "no-store" });
          if (res.ok) {
            const list = await res.json();
            for (const n of list.items ?? []) {
              await self.registration.showNotification(n.title || "LUCK", {
                body: n.body || "",
                icon: "/favicon.ico",
                badge: "/favicon.ico",
                data: { url: n.url || "/" },
                tag: n.tag || n.id,
                requireInteraction: false,
              });
            }
          }
        } catch {}
        return;
      }

      // Direct payload push
      await self.registration.showNotification(payload.title || "LUCK", {
        body: payload.body || "",
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        data: { url: payload.url || "/" },
        tag: payload.tag,
        requireInteraction: false,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
