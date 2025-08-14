const CACHE_NAME = 'weekend-adventure-v1.0.0';
const STATIC_CACHE = `${CACHE_NAME}-static`;
const DYNAMIC_CACHE = `${CACHE_NAME}-dynamic`;
const API_CACHE = `${CACHE_NAME}-api`;

// Files to cache immediately
const STATIC_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './adventure-planner.js',
  './storage-manager.js',
  './theme-manager.js',
  './weather-manager.js',
  './gesture-manager.js',
  './sharing-manager.js',
  './accessibility-manager.js',
  './recommendations-engine.js',
  './animations-manager.js',
  './pwa.js',
  './init.js',
  './manifest.json',
  // Add fallback pages
  './offline.html'
];

// API endpoints to cache
const API_URLS = [
  'https://nominatim.openstreetmap.org',
  'https://overpass-api.de/api/interpreter',
  'https://api.openweathermap.org'
];

// Install event - cache static files
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_FILES.map(url => {
          // Handle root path
          return url === './' ? './index.html' : url;
        }));
      })
      .catch(error => {
        console.error('Service Worker: Failed to cache static files', error);
      })
  );
  
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('weekend-adventure-') && 
              cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE && 
              cacheName !== API_CACHE) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  self.clients.claim();
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-HTTP requests
  if (!request.url.startsWith('http')) {
    return;
  }
  
  // Handle different types of requests
  if (isStaticFile(url)) {
    event.respondWith(handleStaticFile(request));
  } else if (isAPIRequest(url)) {
    event.respondWith(handleAPIRequest(request));
  } else {
    event.respondWith(handleDynamicRequest(request));
  }
});

// Check if request is for static files
function isStaticFile(url) {
  const staticExtensions = ['.html', '.css', '.js', '.json', '.png', '.jpg', '.svg', '.ico'];
  return staticExtensions.some(ext => url.pathname.endsWith(ext)) || 
         url.pathname === '/' || 
         STATIC_FILES.includes(url.pathname);
}

// Check if request is for API
function isAPIRequest(url) {
  return API_URLS.some(apiUrl => url.href.startsWith(apiUrl));
}

// Handle static files - cache first strategy
async function handleStaticFile(request) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log('Service Worker: Serving static file from cache:', request.url);
      return cached;
    }
    
    // If not in cache, fetch and cache
    const response = await fetch(request);
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
    
  } catch (error) {
    console.error('Service Worker: Static file error:', error);
    
    // Return offline page for HTML requests
    if (request.destination === 'document') {
      const cache = await caches.open(STATIC_CACHE);
      return cache.match('/offline.html') || new Response('Offline');
    }
    
    return new Response('Network error', { status: 408 });
  }
}

// Handle API requests - network first with cache fallback
async function handleAPIRequest(request) {
  try {
    // Try network first
    const response = await fetch(request);
    
    if (response.status === 200) {
      // Cache successful API responses
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
      console.log('Service Worker: API response cached:', request.url);
    }
    
    return response;
    
  } catch (error) {
    console.log('Service Worker: API network failed, trying cache:', request.url);
    
    // Fallback to cache
    const cache = await caches.open(API_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log('Service Worker: Serving API from cache:', request.url);
      return cached;
    }
    
    // Return mock data for critical APIs
    return getMockAPIResponse(request);
  }
}

// Handle dynamic requests - network first
async function handleDynamicRequest(request) {
  try {
    const response = await fetch(request);
    
    // Cache successful responses
    if (response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    // Try cache
    const cache = await caches.open(DYNAMIC_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    return new Response('Offline', { status: 408 });
  }
}

// Generate mock API responses for offline functionality
function getMockAPIResponse(request) {
  const url = new URL(request.url);
  
  // Mock geocoding response
  if (url.hostname === 'nominatim.openstreetmap.org') {
    return new Response(JSON.stringify([{
      lat: "40.7128",
      lon: "-74.0060",
      display_name: "New York, NY (Cached Location)"
    }]), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Mock places response
  if (url.hostname === 'overpass-api.de') {
    return new Response(JSON.stringify({
      elements: [
        {
          id: 1,
          lat: 40.7128,
          lon: -74.0060,
          tags: {
            name: "Local Cafe (Offline)",
            amenity: "cafe"
          }
        },
        {
          id: 2,
          lat: 40.7130,
          lon: -74.0058,
          tags: {
            name: "City Park (Offline)",
            leisure: "park"
          }
        }
      ]
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('API temporarily unavailable', { status: 503 });
}

// Background sync for failed requests
self.addEventListener('sync', event => {
  console.log('Service Worker: Background sync triggered:', event.tag);
  
  if (event.tag === 'upload-adventure') {
    event.waitUntil(uploadPendingAdventures());
  }
});

// Upload pending adventures when back online
async function uploadPendingAdventures() {
  // This would sync with a backend if we had one
  // For now, just log that we're back online
  console.log('Service Worker: Back online, syncing adventures...');
  
  // Notify the app that we're back online
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'BACK_ONLINE',
      data: { message: 'Connection restored!' }
    });
  });
}

// Handle push notifications (for future use)
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: data.data,
    actions: [
      {
        action: 'explore',
        title: 'Explore Now',
        icon: '/icon-explore.png'
      },
      {
        action: 'later',
        title: 'Remind Later',
        icon: '/icon-later.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/?notification=explore')
    );
  } else if (event.action === 'later') {
    // Schedule a reminder (would need backend support)
    console.log('Reminder scheduled');
  } else {
    // Default action - open app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});