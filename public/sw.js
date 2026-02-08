/* global clients */
/* eslint-disable no-unused-vars */
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

const CACHE_NAME = 'roam-v2'
const STATIC_CACHE = 'roam-static-v2'
const IMAGE_CACHE = 'roam-images-v2'
const MAP_TILE_CACHE = 'roam-map-tiles-v1'
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1'

// Request deduplication - coalesce simultaneous identical requests
const pendingRequests = new Map()
const DEDUP_TIMEOUT = 30000 // 30s timeout to prevent memory leaks

async function deduplicatedFetch(request) {
  const key = request.url + (request.method || 'GET')

  // If this exact request is already in-flight, wait for it
  if (pendingRequests.has(key)) {
    const response = await pendingRequests.get(key)
    return response.clone()
  }

  // Create abort controller for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
    pendingRequests.delete(key)
  }, DEDUP_TIMEOUT)

  // Start the fetch and store the promise
  // Clone response before returning to avoid "body already read" race condition
  const fetchPromise = fetch(request, { signal: controller.signal }).then(response => {
    clearTimeout(timeoutId)
    pendingRequests.delete(key)
    return response.clone() // Return clone so original can be cloned by other waiters
  }).catch(err => {
    clearTimeout(timeoutId)
    pendingRequests.delete(key)
    throw err
  })

  pendingRequests.set(key, fetchPromise)
  return fetchPromise
}

// L14: Debug logging - only enabled in development
const DEBUG = IS_LOCALHOST
const log = (...args) => { if (DEBUG) console.log(...args) }

// Map tile providers to cache for offline use
const MAP_TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com',
  'b.basemaps.cartocdn.com',
  'c.basemaps.cartocdn.com',
  'd.basemaps.cartocdn.com'
]

// Maximum number of tiles to cache (prevents storage bloat)
const MAX_MAP_TILES = 500

// Files to cache immediately on install
const PRECACHE_FILES = [
  '/index.html',
  '/manifest.json'
]

// Install event - cache app shell
self.addEventListener('install', (event) => {
  log('Service Worker: Installing...')

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        log('Service Worker: Precaching app shell')
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
  log('Service Worker: Activating...')

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old versions of our caches
            if (cacheName.startsWith('roam-') &&
                cacheName !== CACHE_NAME &&
                cacheName !== STATIC_CACHE &&
                cacheName !== IMAGE_CACHE &&
                cacheName !== MAP_TILE_CACHE) {
              log('Service Worker: Deleting old cache:', cacheName)
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

  // Always use network-first for navigations to avoid stale app shells.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return
  }

  // Handle different request types
  if (isMapTileRequest(url)) {
    // Map tiles: Cache first with LRU eviction
    event.respondWith(cacheMapTile(request))
  } else if (isApiRequest(url)) {
    // Use stale-while-revalidate for user data APIs (instant loads + background refresh)
    if (USER_DATA_APIS.some(api => url.pathname.startsWith(api))) {
      event.respondWith(staleWhileRevalidate(request))
    } else {
      // Other API requests: Network first, cache fallback
      event.respondWith(networkFirst(request))
    }
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

// Check if request is for a map tile
function isMapTileRequest(url) {
  return MAP_TILE_HOSTS.some(host => url.hostname.includes(host)) ||
         /\/\d+\/\d+\/\d+\.png$/i.test(url.pathname)
}

// Network first strategy
async function networkFirst(request) {
  try {
    const networkResponse = await deduplicatedFetch(request)

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
      log('Service Worker: Serving from cache (offline):', request.url)
      return cachedResponse
    }

    // No cache, return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/index.html')
    }

    throw error
  }
}

// User data APIs that benefit from stale-while-revalidate
const USER_DATA_APIS = ['/api/places/saved', '/api/users/stats', '/api/collections']

// Stale-while-revalidate strategy for user data APIs
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(request)

  // Start network fetch in background
  const fetchPromise = deduplicatedFetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  }).catch(() => cachedResponse) // Fall back to cached on error

  // Return cached immediately if available, otherwise wait for network
  return cachedResponse || fetchPromise
}

// Cache first strategy
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request)

  if (cachedResponse) {
    log('Service Worker: Serving static file from cache:', request.url)
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

// Map tile caching with LRU eviction
async function cacheMapTile(request) {
  const cache = await caches.open(MAP_TILE_CACHE)
  const cachedResponse = await cache.match(request)

  if (cachedResponse) {
    return cachedResponse
  }

  try {
    const safeRequest = request.cache === 'only-if-cached' && request.mode !== 'same-origin'
      ? new Request(request.url, { mode: 'no-cors', cache: 'reload' })
      : request
    const networkResponse = await fetch(safeRequest)

    if (networkResponse.ok || networkResponse.type === 'opaque') {
      // Clone response before caching
      const responseToCache = networkResponse.clone()

      // Cache the tile and manage cache size
      cache.put(request, responseToCache).then(() => {
        trimMapTileCache()
      })
    }

    return networkResponse
  } catch (error) {
    // Retry with a simplified request before falling back
    try {
      const retryResponse = await fetch(new Request(request.url, { mode: 'no-cors', cache: 'reload' }))
      if (retryResponse) {
        return retryResponse
      }
    } catch {
      // Ignore retry errors
    }

    // Return a placeholder tile for offline (transparent 256x256 PNG)
    log('Service Worker: Map tile unavailable offline:', request.url)
    return new Response(
      // Minimal transparent PNG (1x1, will be stretched)
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)),
      {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      }
    )
  }
}

// Trim map tile cache to prevent storage bloat
async function trimMapTileCache() {
  const cache = await caches.open(MAP_TILE_CACHE)
  const keys = await cache.keys()

  if (keys.length > MAX_MAP_TILES) {
    // Delete oldest tiles (first in cache = oldest)
    const deleteCount = keys.length - MAX_MAP_TILES
    log(`Service Worker: Trimming ${deleteCount} old map tiles`)

    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i])
    }
  }
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  // Prefetch map tiles for offline use
  if (event.data && event.data.type === 'PREFETCH_MAP_TILES') {
    const { tileUrls } = event.data
    if (tileUrls && Array.isArray(tileUrls)) {
      prefetchMapTiles(tileUrls)
    }
  }

  // Clear map tile cache
  if (event.data && event.data.type === 'CLEAR_MAP_CACHE') {
    caches.delete(MAP_TILE_CACHE).then(() => {
      log('Service Worker: Map tile cache cleared')
    })
  }
})

// Prefetch map tiles in background
async function prefetchMapTiles(tileUrls) {
  log(`Service Worker: Prefetching ${tileUrls.length} map tiles`)
  const cache = await caches.open(MAP_TILE_CACHE)

  for (const url of tileUrls) {
    try {
      const cached = await cache.match(url)
      if (!cached) {
        const response = await fetch(url)
        if (response.ok) {
          await cache.put(url, response)
        }
      }
    } catch {
      // Ignore individual tile failures
    }
  }

  // Trim after prefetch
  await trimMapTileCache()
  log('Service Worker: Map tile prefetch complete')
}

// ═══════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════

// Handle push notifications
self.addEventListener('push', (event) => {
  // L14: Removed console.log for production

  let data = {
    title: 'ROAM',
    body: 'You have a new notification',
    // L13: Use correct icon path matching manifest.json
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'roam-notification',
    data: {}
  }

  if (event.data) {
    try {
      const payload = event.data.json()

      // Handle silent badge updates - send message to app instead of showing notification
      if (payload.data?.type === 'BADGE_UPDATE') {
        event.waitUntil(
          clients.matchAll({ type: 'window' }).then(windowClients => {
            windowClients.forEach(client => {
              client.postMessage({
                type: 'NOTIFICATION_COUNT',
                count: payload.data.unreadCount
              })
            })
          })
        )
        return // Don't show visible notification for badge updates
      }

      data = { ...data, ...payload }
    } catch {
      data.body = event.data.text()
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    data: data.data,
    vibrate: [100, 50, 100],
    actions: data.actions || [
      { action: 'open', title: 'Open ROAM' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    requireInteraction: data.requireInteraction || false
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  log('Service Worker: Notification clicked', event.action)

  event.notification.close()

  if (event.action === 'dismiss') {
    return
  }

  // Get the URL to open
  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Check if there's already a window open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus()
            if (urlToOpen !== '/') {
              client.navigate(urlToOpen)
            }
            return
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen)
        }
      })
  )
})

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  log('Service Worker: Notification closed')
})
