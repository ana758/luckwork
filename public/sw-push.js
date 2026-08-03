/* LUCK Web Push service worker */
const CACHE = "luck-push-v2";

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function show(n) {
  return self.registration.showNotification(n.title || "LUCK", {
    body: n.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: n.url || "/" },
    tag: n.tag || n.id || undefined,
    renotify: true,
    silent: false,
    vibrate: [200, 100, 200, 100, 300],
    requireInteraction: false,
    timestamp: Date.now(),
  });
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = null;
      try {
        if (event.data) payload = event.data.json();
      } catch {
        try {
          const text = event.data && event.data.text();
          if (text) payload = { title: "LUCK", body: text };
        } catch {}
      }

      // Direct payload push (normal path)
      if (payload && (payload.title || payload.body)) {
        await show(payload);
        return;
      }

      // Wake-up push (no payload): fetch pending
      let shown = 0;
      try {
        const res = await fetch("/api/public/hooks/pending-pushes", { cache: "no-store" });
        if (res.ok) {
          const list = await res.json();
          for (const n of list.items ?? []) {
            await show(n);
            shown++;
          }
        }
      } catch {}

      // iOS/Chrome require a visible notification for every push
      if (shown === 0) {
        await show({ title: "LUCK", body: "Você tem novas atualizações", url: "/" });
      }
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
