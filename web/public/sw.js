/* Trenchers app: shows notifications sent by the trading engine (your agent's trades, the weekly report). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Trenchers", body: e.data ? e.data.text() : "" }; }
  const icon = d.agent ? `/nft/${d.agent}.webp` : "/app/icon-192.png";
  e.waitUntil(self.registration.showNotification(d.title || "Trenchers", { body: d.body || "", icon, badge: "/app/icon-192.png", tag: d.tag, data: { url: d.url || "/agents" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/agents";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c && c.url.startsWith(self.location.origin)) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
