// Service worker mínimo: guarda la app para que abra sin internet (los datos vienen de Firebase).
const CACHE = 'nosotros-v18';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './lib/calc.js', './lib/store.js', './lib/icons.js', './lib/tvmaze.js', './lib/chat.js', './lib/media.js', './lib/confetti.js', './lib/cache.js', './lib/disguise.js', './lib/prefs.js', './lib/net.js', './lib/tmdb.js', './lib/series.js', './tmdb-config.js', './lib/native.js', './theme.js', './firebase-config.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // red primero (para ver siempre la versión nueva), caché si no hay conexión
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
