// Sube este número cada vez que quieras forzar una limpieza total de caché.
// No es obligatorio tocarlo en cada deploy (la estrategia network-first ya
// evita el contenido obsoleto), pero es útil como "botón de pánico".
const CACHE_VERSION = 'v6';
const CACHE_NAME = `analytics-panel-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// Permite forzar la activación inmediata de un SW nuevo desde app.js
// (por ejemplo, tras detectar una actualización) sin esperar a que se
// cierren todas las pestañas.
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // NETWORK-FIRST: siempre intenta traer la versión más reciente del
  // servidor. Solo si la red falla (o no hay conexión) se usa la copia
  // en caché. Esto es lo que evita ver contenido viejo tras un redeploy.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) return cachedResponse;
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
          }
          return Response.error();
        });
      })
  );
});
