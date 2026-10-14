// Service worker for Background Remover (generated into dist/sw.js at build time).
// - App shell: precached per build, served cache-first; the page itself is network-first so
//   deploys show up straight away, falling back to the cache when offline.
// - ONNX Runtime files (ort-<version>/): cached the first time they're fetched.
// - Model weights are cross-origin (Hugging Face) and cached by the inference worker, not here.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const ORT_DIR = '__ORT_DIR__';
const SHELL = `bgremover-shell-${VERSION}`;
const RUNTIME = 'bgremover-runtime-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('bgremover-shell-') && key !== SHELL) await caches.delete(key);
      }
      // Drop runtime entries left by older ONNX Runtime versions.
      const rt = await caches.open(RUNTIME);
      for (const req of await rt.keys()) {
        if (!new URL(req.url).pathname.includes(`/${ORT_DIR}/`)) await rt.delete(req);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(SHELL)).put('./', res.clone());
          return res;
        } catch {
          return (await caches.match('./', { cacheName: SHELL, ignoreVary: true })) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      // ignoreVary: hosts send e.g. "Vary: Origin" and module scripts carry an Origin header the precache request didn't.
      const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && url.pathname.includes(`/${ORT_DIR}/`)) (await caches.open(RUNTIME)).put(req, res.clone());
      return res;
    })(),
  );
});
