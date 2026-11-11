// Service Worker de Control de Acceso — permite que la app abra sin conexión a internet
// después de haberla visitado al menos una vez con conexión.
// v9: ahora revisa primero internet (network-first) y sólo usa la copia guardada
// si no hay conexión — así ya no hace falta borrar datos del sitio cada vez que se actualiza la app.
// v10: agrega el sistema de QR (visita.html, qr-acceso.js, qrcode.js, jsQR.js) para que también funcione sin conexión.
// v11: N° económico de la unidad para transporte de personal regional.
// v12: ficha y catálogo de unidades de transporte; pase de unidad permanente con caducidad.
// v13: formato de Inocuidad RE-PL-164 (PDF y Excel) en el panel.
// v15: el formato RE-PL-164 ya no incluye la columna FIRMA (PDF y Excel).
// v14: el archivo exportado lleva campo, días de captura y hora con segundos (ya no se reemplazan en la carpeta).
const CACHE_NAME = 'control-acceso-cache-v16';
const ASSETS = [
  './',
  './index.html',
  './panel.html',
  './visita.html',
  './qr-acceso.js',
  './qrcode.js',
  './jsQR.js',
  './manifest.json',
  './panel-manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './panel-icon-192.png',
  './panel-icon-512.png',
  './panel-apple-touch-icon.png',
  './inocuidad/re-pl-164.js',
  './inocuidad/RE-PL-164.pdf',
  './inocuidad/logo.png',
  './inocuidad/pdf-lib.min.js',
  './inocuidad/jszip.min.js'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return Promise.all(ASSETS.map(function(url){
        return cache.add(url).catch(function(err){ console.warn('No se pudo cachear', url, err); });
      }));
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Apertura rápida aunque la señal sea débil: si la red no responde en 3 segundos se abre la copia guardada
// (y la red la actualiza por detrás). Antes, con poca señal, la app se quedaba congelada en el ícono.
const TIEMPO_RED = 3000;
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const red = fetch(req, { cache: 'no-store' }).then(r => {
    if (r && r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE_NAME).then(c => c.put(req, cp)).catch(() => {}); }
    return r;
  });
  e.waitUntil(red.then(() => {}, () => {}));
  e.respondWith((async () => {
    const c = await caches.open(CACHE_NAME);
    const guardado = (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? ((await c.match('./index.html')) || (await c.match('./'))) : undefined);
    if (!guardado) return red.catch(() => Response.error());
    const r = await Promise.race([red.catch(() => null), new Promise(res => setTimeout(() => res(null), TIEMPO_RED))]);
    return (r && r.ok) ? r : guardado;
  })());
});
