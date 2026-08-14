// Service worker voor PloegCompleet.
// Enige taak hier: inkomende pushmeldingen tonen (geen "installeerbaar maken"
// nodig zoals bij de mobiele app -- op desktop werkt push ook vanuit een
// gewoon open tabblad).

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = { titel: "PloegCompleet", tekst: "Er is een update.", url: "./ploegcompleet.html" };
  try { data = Object.assign(data, event.data.json()); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.titel, {
      body: data.tekst,
      data: { url: data.url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./ploegcompleet.html";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((lijst) => {
      for (const client of lijst) {
        if (client.url.includes("ploegcompleet.html") && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
