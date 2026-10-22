// Offline support for Mine Lode. Plain script (no build step) so it can sit at the site base and use its own scope.
// Rules: same-origin GET only, inside the scope. A request to any other origin (the human check script above all)
// and anything under /api/ is never intercepted, so scores are always live. Static assets are cache-first; pages are
// network-first with the cache as the offline fallback. Every cache lookup passes { ignoreVary: true }.
// The cache name and the asset rule must match src/scripts/pwa.ts.
const CACHE = 'mine-lode-v1';
const SCOPE_PATH = new URL(self.registration.scope).pathname; // "/", or "/mine-lode/" under a base
const MATCH = { ignoreVary: true };

const isStatic = (pathname) => {
  if (!pathname.startsWith(SCOPE_PATH)) return false;
  const rest = pathname.slice(SCOPE_PATH.length);
  return /^_astro\//.test(rest) || /^icon-\d+\.png$/.test(rest) || /^music\/[a-z0-9-]+\.mp3$/.test(rest) || rest === 'manifest.webmanifest';
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SCOPE_PATH, `${SCOPE_PATH}manifest.webmanifest`, `${SCOPE_PATH}icon-180.png`, `${SCOPE_PATH}icon-192.png`, `${SCOPE_PATH}icon-512.png`]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mine-lode-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;

  if (isStatic(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request, MATCH);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) await cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const res = await fetch(request);
          if (res.ok) await cache.put(request, res.clone());
          return res;
        } catch (err) {
          const hit = (await cache.match(request, MATCH)) || (await cache.match(SCOPE_PATH, MATCH));
          if (hit) return hit;
          throw err;
        }
      }),
    );
  }
});
