/**
 * ROAM Service Worker
 *
 * Provides offline support and caching for the PWA.
 *
 * Caching Strategy:
 * - App shell (HTML, CSS, JS): Cache first, update in background
 * - API calls: Network first, fall back to cache
 * - Images: Cache first with network fallback
 * - Static files: Cache first
 */

const CACHE_NAME = 'roam-v1'
const STATIC_CACHE = 'roam-static-v1'
const IMAGE_CACHE = 'roam-images-v1'
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1'

// Files to cache immediately on install
const PRECACHE_FILES = [
  '/',
  '/index.html',
  '/manifest.json'
]

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...')

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Service Worker: Precaching app shell')
        return cache.addAll(PRECACHE_FILES)
      })
      .then(() => {
        // Skip waiting to activate immediately
        return self.skipWaiting()
      })
  )
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...')

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old versions of our caches
            if (cacheName.startsWith('roam-') &&
                cacheName !== CACHE_NAME &&
                cacheName !== STATIC_CACHE &&
                cacheName !== IMAGE_CACHE) {
              console.log('Service Worker: Deleting old cache:', cacheName)
              return caches.delete(cacheName)
            }
          })
        )
      })
      .then(() => {
        // Take control of all pages immediately
        return self.clients.claim()
      })
  )
})

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  if (IS_LOCALHOST) {
    return
  }

  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return
  }

  // Handle different request types
  if (isApiRequest(url)) {
    // API requests: Network first, cache fallback
    event.respondWith(networkFirst(request))
  } else if (isImageRequest(url, request)) {
    // Images: Cache first, network fallback
    event.respondWith(cacheFirst(request, IMAGE_CACHE))
  } else if (isStaticAsset(url)) {
    // Static assets (JS, CSS): Cache first
    event.respondWith(cacheFirst(request, STATIC_CACHE))
  } else {
    // Everything else: Network first
    event.respondWith(networkFirst(request))
  }
})

// Check if request is an API call
function isApiRequest(url) {
  return url.pathname.startsWith('/api/') ||
         url.hostname.includes('overpass-api') ||
         url.hostname.includes('opentripmap') ||
         url.hostname.includes('wikipedia') ||
         url.hostname.includes('nominatim') ||
         url.hostname.includes('ticketmaster') ||
         url.hostname.includes('eventbrite') ||
         url.hostname.includes('skiddle')
}

// Check if request is for an image
function isImageRequest(url, request) {
  const acceptHeader = request.headers.get('Accept') || ''
  return acceptHeader.includes('image/') ||
         /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname) ||
         url.hostname.includes('unsplash') ||
         url.hostname.includes('wikipedia') && url.pathname.includes('thumb')
}

// Check if request is for a static asset
function isStaticAsset(url) {
  return /\.(js|css|woff|woff2|ttf|eot)$/i.test(url.pathname) ||
         url.pathname.startsWith('/assets/')
}

// Network first strategy
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request)

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, networkResponse.clone())
    }

    return networkResponse
  } catch (error) {
    // Network failed, try cache
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
      console.log('Service Worker: Serving from cache (offline):', request.url)
      return cachedResponse
    }

    // No cache, return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/index.html')
    }

    throw error
  }
}

// Cache first strategy
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request)

  if (cachedResponse) {
    console.log('Service Worker: Serving static file from cache:', request.url)
    return cachedResponse
  }

  try {
    const networkResponse = await fetch(request)

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, networkResponse.clone())
    }

    return networkResponse
  } catch (error) {
    console.error('Service Worker: Failed to fetch:', request.url)
    throw error
  }
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
