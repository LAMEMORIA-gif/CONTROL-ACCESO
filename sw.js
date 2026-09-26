// Service Worker de Control de Acceso — permite que la app abra sin conexión a internet
// después de haberla visitado al menos una vez con conexión.
// v9: ahora revisa primero internet (network-first) y sólo usa la copia guardada
// si no hay conexión — así ya no hace falta borrar datos del sitio cada vez que se actualiza la app.
const CACHE_NAME = 'control-acceso-cache-v9';
const ASSETS = [
  './',
  './index.html',
  './panel.html',
  './manifest.json',
  './panel-manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './panel-icon-192.png',
  './panel-icon-512.png',
  './panel-apple-touch-icon.png'
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
