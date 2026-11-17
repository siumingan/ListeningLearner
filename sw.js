/* ListeningLearner service worker: makes the app installable and lets it open offline.
 * App files: served from cache, refreshed in the background.
 * /api, /media, and other websites (YouTube, translation): always from the network, never cached.
 */
const CACHE = 'll-shell-v4';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/languages.js', 'js/native.js', 'js/server.js', 'js/lines.js', 'js/subtitles.js', 'js/translate.js', 'js/tts.js', 'js/players.js',
  'js/linkcheck.js', 'js/app.js', 'js/server.js', 'js/pipeline-ui.js', 'js/mobile.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon.png'
];

self.addEventListener('install', function (event) {
  // cache files one by one: one slow or missing file must not stop the app from installing
  event.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (f) { return c.add(new Request(f, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // YouTube, translation APIs...
  if (/\/(api|media)\//.test(url.pathname)) return;            // live data from the PC
  if (req.headers.get('range')) return;                       // video seeking

  // The share target and start_url carry query strings: answer them with the cached page
  const isPage = req.mode === 'navigate';
  const cacheKey = isPage ? new Request(new URL('index.html', self.registration.scope)) : req;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(cacheKey).then(function (cached) {
        const fresh = fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') cache.put(cacheKey, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || fresh;
      });
    })
  );
});
