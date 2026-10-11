// Snack Shop service worker: installable, fast on bad signal.
// Pages and files: network first (a new deploy shows right away), but if the network takes over 4 s the saved copy is shown instead.
// Product pictures and the /vendor scripts: saved on the device, shown instantly. Live data (/api/...) is never stored.
const CACHE = 'shop-v20-fix';
const IMG = 'shop-img-v1';
const SHELL = ['/', '/style.css', '/boost.css', '/app.js', '/boost.js', '/tour.js', '/admin-plus.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/vendor/gsap.min.js', '/vendor/lenis.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== IMG).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function netFirst(r) {
  const c = await caches.open(CACHE);
  const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; });
  const late = new Promise((ok) => setTimeout(ok, 4000)).then(async () => (await c.match(r)) || net);
  try { return await Promise.race([net, late]); }
  catch (err) { return (await c.match(r)) || (r.mode === 'navigate' ? await c.match('/') : Response.error()); }
}

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  if (/^\/api\/products\/\d+\/image/.test(u.pathname)) {
    // Picture URLs carry a version (?v=), so a changed picture is a new URL: safe to serve from the cache first.
    e.respondWith(caches.open(IMG).then((c) => c.match(r).then((hit) => hit || fetch(r).then((res) => {
      if (res.ok) { c.put(r, res.clone()); c.keys().then((k) => { if (k.length > 300) c.delete(k[0]); }); }
      return res;
    }))));
    return;
  }
  if (u.pathname.startsWith('/api/')) return;
  if (u.pathname.startsWith('/vendor/')) { // version-pinned by npm: cache first
    e.respondWith(caches.open(CACHE).then((c) => c.match(r).then((hit) => hit || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }))));
    return;
  }
  e.respondWith(netFirst(r));
});
