// Snack Shop service worker: makes the shop installable on Android Chrome.
// Pages and files are fetched from the network first (so a new deploy shows up right away) and kept as a fallback for when the signal drops.
// Live data (/api/...) is never stored.
const CACHE = 'shop-v1';
const SHELL = ['/', '/style.css', '/app.js', '/tour.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(r).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r).then((hit) => hit || (r.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
