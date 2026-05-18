// M · OS Service Worker
// Maneja notificaciones push en background

const CACHE_NAME = 'mos-v1';

self.addEventListener('install', function(e){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(clients.claim());
});

// Cache the main app for offline use
self.addEventListener('fetch', function(e){
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(response){
        if(e.request.url.indexOf('index.html') > -1 || e.request.url.endsWith('/')){
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(e.request, clone);
          });
        }
        return response;
      });
    }).catch(function(){
      // Offline fallback
      if(e.request.mode === 'navigate'){
        return caches.match('/m-os/index.html');
      }
    })
  );
});

// Push notification handler
self.addEventListener('push', function(e){
  var data = e.data ? e.data.json() : {};
  var title = data.title || 'M · OS';
  var body = data.body || 'Recordatorio';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/m-os/icon.png',
      badge: '/m-os/icon.png',
      vibrate: [200, 100, 200]
    })
  );
});

// Notification click — open the app
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window'}).then(function(clientList){
      for(var i=0;i<clientList.length;i++){
        if(clientList[i].url.indexOf('m-os') > -1 && 'focus' in clientList[i]){
          return clientList[i].focus();
        }
      }
      if(clients.openWindow){
        return clients.openWindow('https://marronos.github.io/m-os/');
      }
    })
  );
});

// Schedule daily notifications via SW
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SCHEDULE_NOTIF'){
    var delay = e.data.delay;
    var title = e.data.title;
    var body = e.data.body;
    setTimeout(function(){
      self.registration.showNotification(title, {
        body: body,
        icon: '/m-os/icon.png',
        vibrate: [200, 100, 200]
      });
    }, delay);
  }
});
