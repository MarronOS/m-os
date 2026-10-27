// M · OS Service Worker (v10)
// Red primero para la app (así siempre ves la última versión); caché solo como respaldo sin conexión.
// Las llamadas a Supabase nunca se cachean.

const CACHE_NAME = 'mos-v10';

self.addEventListener('install', function(e){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fuentes, etc.: directo a la red
  e.respondWith(
    fetch(req).then(function(res){
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(c){ c.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){
        return hit || (req.mode === 'navigate' ? caches.match('./index.html') || caches.match('./') : undefined);
      });
    })
  );
});

// Notificaciones push
self.addEventListener('push', function(e){
  var data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'M · OS', {
      body: data.body || 'Recordatorio',
      vibrate: [200, 100, 200]
    })
  );
});

// Al tocar la notificación, abre la app
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type: 'window'}).then(function(list){
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
