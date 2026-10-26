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
const CACHE_NAME = 'control-acceso-cache-v15';
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

self.addEventListener('fetch', function(event){
  if(event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(function(response){
      if(response && response.status===200 && response.type==='basic'){
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, clone); });
      }
      return response;
    }).catch(function(){
      return caches.match(event.request).then(function(cached){
        if(cached) return cached;
        if(event.request.mode === 'navigate'){ return caches.match('./index.html'); }
      });
    })
  );
});
