/* Campus guide offline cache. Registered only by the campus guide page.
   Network first for everything it handles, so online visitors always get fresh files; the cache is used
   only when the network fails. Private API calls are never touched. */
'use strict';
const CACHE = 'nerd-campus-v2';
const SHELL = [
  '/', '/favicon.svg', '/css/app.css', '/css/compass.css', '/css/compass-admin.css', '/css/sheet.css',
  '/js/core.js', '/js/charts.js', '/js/riskviz.js', '/js/public.js', '/js/student.js', '/js/staff.js', '/js/admin.js',
  '/js/compass/data.js', '/js/compass/geo.js', '/js/compass/search.js', '/js/compass/i18n.js', '/js/vendor/qrcode-generator.js',
  '/js/campus.js', '/js/campus-admin.js', '/js/sheet.js', '/js/main.js',
  '/assets/compass/kpriet-campus-layout.webp', '/assets/compass/kpriet-logo.png',
  '/fonts/inter-400.woff2', '/fonts/inter-500.woff2', '/fonts/inter-600.woff2', '/fonts/inter-700.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('nerd-campus-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Public campus data (GET /api/campus/:cid) and published posters may be cached; no other API call is.
function cacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith('/api/')) return true;
  return /^\/api\/campus\/\d+$/.test(url.pathname) || /^\/api\/campus\/files\/[a-f0-9-]{36}$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!cacheable(url)) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      const cc = res.headers.get('Cache-Control') || '';
      const isGuide = /^\/api\/campus\/\d+$/.test(url.pathname);
      if (res.ok && res.type === 'basic' && (isGuide || !/no-store/.test(cc))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req.mode === 'navigate' ? '/' : req, { ignoreSearch: req.mode === 'navigate' });
      return hit || Response.error();
    }
  })());
});
