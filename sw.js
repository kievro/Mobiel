// Service worker voor de Ploeg-mobiele-app.
// Twee taken: (1) installeerbaar maken (vereist door iOS/Android om "Toevoegen
// aan beginscherm" een echte app-ervaring te geven), en (2) inkomende
// pushmeldingen tonen zodra de server-kant die gaat versturen.

const CACHE_NAAM = "ploeg-mobiel-v1";
const KERN_BESTANDEN = ["./ploeg-mobiel.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAAM).then((cache) => cache.addAll(KERN_BESTANDEN))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(namen.filter((n) => n !== CACHE_NAAM).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Simpele "network first, val terug op cache" strategie -- altijd de meest
// actuele gegevens als er verbinding is, maar blijft ook iets tonen offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Wordt aangeroepen zodra de server (via de VAPID-sleutel) een pushbericht
// stuurt, bijvoorbeeld "je bent ingedeeld" of "deze dienst is ingevuld".
self.addEventListener("push", (event) => {
  let data = { titel: "Ploeg", tekst: "Er is een update.", url: "./ploeg-mobiel.html" };
  try { data = Object.assign(data, event.data.json()); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.titel, {
      body: data.tekst,
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: data.url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./ploeg-mobiel.html";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((lijst) => {
      for (const client of lijst) {
        if (client.url.includes("ploeg-mobiel.html") && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
