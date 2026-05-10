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

const CACHE_NAME = 'roam-v3'
const STATIC_CACHE = 'roam-static-v3'
const IMAGE_CACHE = 'roam-images-v2'           // unchanged — preserves existing entries
const MAP_TILE_CACHE = 'roam-map-tiles-v1'     // unchanged — preserves existing entries
const OFFLINE_API_CACHE = 'roam-offline-api-v1' // new — pack API responses
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1'

// ─── Offline pack manifest cache ─────────────────────────────────
//
// The SW reads the pack manifest from IndexedDB on relevant fetches.
// We keep the most-recent manifest in memory so we don't open the DB
// per request. Window dispatches 'pack-changed' postMessage events
// on download / clear / expire to invalidate.

const PACK_DB_NAME = 'roam_offline'
const PACK_DB_VERSION = 1
const PACK_MANIFEST_STORE = 'pack_manifest'

let cachedManifest = null
let cachedManifestAt = 0
const CACHED_MANIFEST_TTL_MS = 30 * 1000 // re-read at most every 30s

function readManifestFromIdb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const req = indexedDB.open(PACK_DB_NAME, PACK_DB_VERSION)
    // If onupgradeneeded fires here, the DB doesn't exist — meaning no
    // pack has ever been downloaded. Abort so we don't create an empty
    // DB at v1; the window-side `openDb()` opens at v1 too and would
    // skip onupgradeneeded if we'd already created the DB, leaving
    // pack_manifest / pack_places / pack_images uncreated and bricking
    // the first download.
    req.onupgradeneeded = (event) => {
      try { event.target.transaction.abort() } catch { /* ignore */ }
    }
    req.onsuccess = () => {
      const db = req.result
      try {
        const tx = db.transaction(PACK_MANIFEST_STORE, 'readonly')
        const get = tx.objectStore(PACK_MANIFEST_STORE).get(1)
        get.onsuccess = () => resolve(get.result || null)
        get.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    }
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

async function getManifest() {
  if (cachedManifest && (Date.now() - cachedManifestAt) < CACHED_MANIFEST_TTL_MS) {
    return cachedManifest
  }
  cachedManifest = await readManifestFromIdb()
  cachedManifestAt = Date.now()
  return cachedManifest
}

// ─── Offline pack routing ────────────────────────────────────────

function urlInsideAnyBbox(lat, lng, bboxes) {
  if (!Array.isArray(bboxes)) return false
  for (const b of bboxes) {
    if (lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east) return true
  }
  return false
}

function readAllPackPlaces() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve([])
    const req = indexedDB.open(PACK_DB_NAME, PACK_DB_VERSION)
    // Same DB-creation guard as readManifestFromIdb — see comment there.
    req.onupgradeneeded = (event) => {
      try { event.target.transaction.abort() } catch { /* ignore */ }
    }
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('pack_places', 'readonly')
        const get = tx.objectStore('pack_places').getAll()
        get.onsuccess = () => resolve(get.result || [])
        get.onerror = () => resolve([])
      } catch { resolve([]) }
    }
    req.onerror = () => resolve([])
  })
}

/**
 * Decide if this fetch should be served from the offline pack.
 * Returns a Response or null (caller falls back to existing strategies).
 */
async function maybeServeFromOfflinePack(request) {
  if (typeof navigator !== 'undefined' && navigator.onLine !== false) return null
  const url = new URL(request.url)

  // Same-origin only
  if (url.origin !== self.location.origin) return null

  const manifest = await getManifest()
  if (!manifest || manifest.status !== 'ready') return null

  // 1. /api/wikipedia/summary and /api/places/image-resolve — direct cache lookup
  if (
    url.pathname === '/api/wikipedia/summary' ||
    url.pathname === '/api/places/image-resolve'
  ) {
    const cache = await caches.open(OFFLINE_API_CACHE)
    const hit = await cache.match(request)
    if (hit) return hit
    return new Response(JSON.stringify({ error: 'offline', message: 'No cached data for this request' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 2. /api/places/overpass/nearby — bbox check then synthesize a response from pack_places
  if (url.pathname === '/api/places/overpass/nearby' && request.method === 'POST') {
    try {
      const body = await request.clone().json()
      const m = body?.query?.match(/bbox:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/)
      if (!m) return null
      const south = parseFloat(m[1])
      const west = parseFloat(m[2])
      const north = parseFloat(m[3])
      const east = parseFloat(m[4])
      const inside = urlInsideAnyBbox((south + north) / 2, (west + east) / 2, manifest.deckBboxes)
      if (!inside) return null
      // Synthesize an Overpass response from cached places
      const allPlaces = await readAllPackPlaces()
      const filtered = allPlaces.filter((p) =>
        p.placeData.lat >= south && p.placeData.lat <= north &&
        p.placeData.lng >= west && p.placeData.lng <= east
      )
      const elements = filtered.map((p) => ({
        id: Number(p.placeId) || p.placeId,
        type: 'node',
        lat: p.placeData.lat,
        lon: p.placeData.lng,
        tags: p.placeData.tags || {},
        center: { lat: p.placeData.lat, lon: p.placeData.lng },
      }))
      return new Response(JSON.stringify({ version: 0.6, elements }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Roam-Cache': 'offline-pack' },
      })
    } catch {
      return null
    }
  }

  return null
}

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
                cacheName !== MAP_TILE_CACHE &&
                cacheName !== OFFLINE_API_CACHE) {
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
//
// The listener body has been extracted into defaultFetchStrategy() so the
// offline-pack short-circuit can run first. event.respondWith is called
// exactly once, and defaultFetchStrategy always returns a Response.
async function defaultFetchStrategy(request) {
  if (IS_LOCALHOST) {
    return fetch(request)
  }

  const url = new URL(request.url)

  // Always use network-first for navigations to avoid stale app shells.
  if (request.mode === 'navigate') {
    return await networkFirst(request)
  }

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return fetch(request)
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return fetch(request)
  }

  // Handle different request types
  if (isMapTileRequest(url)) {
    // Map tiles: Cache first with LRU eviction
    return await cacheMapTile(request)
  } else if (isApiRequest(url)) {
    // Use stale-while-revalidate for user data APIs (instant loads + background refresh)
    if (USER_DATA_APIS.some(api => url.pathname.startsWith(api))) {
      return await staleWhileRevalidate(request)
    } else {
      // Other API requests: Network first, cache fallback
      return await networkFirst(request)
    }
  } else if (isImageRequest(url, request)) {
    // Images: Cache first, network fallback
    return await cacheFirst(request, IMAGE_CACHE)
  } else if (isStaticAsset(url)) {
    // Static assets (JS, CSS): Cache first
    return await cacheFirst(request, STATIC_CACHE)
  } else {
    // Everything else: Network first
    return await networkFirst(request)
  }
}

self.addEventListener('fetch', (event) => {
  event.respondWith((async () => {
    const packResponse = await maybeServeFromOfflinePack(event.request)
    if (packResponse) return packResponse
    return await defaultFetchStrategy(event.request)
  })())
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
// Note: Cache API doesn't guarantee order, so we can't do true LRU.
// We delete tiles from the start of the returned array, which is effectively
// random eviction. This is acceptable for map tiles since they're cheap to
// re-fetch and users typically stay in similar geographic areas.
async function trimMapTileCache() {
  const cache = await caches.open(MAP_TILE_CACHE)
  const keys = await cache.keys()

  if (keys.length > MAX_MAP_TILES) {
    const deleteCount = keys.length - MAX_MAP_TILES
    log(`Service Worker: Trimming ${deleteCount} map tiles (random eviction)`)

    // Delete in parallel for better performance
    const deletePromises = keys.slice(0, deleteCount).map(key => cache.delete(key))
    await Promise.all(deletePromises)
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

  // Invalidate in-memory pack manifest cache (window dispatches this on
  // download / clear / expire so the SW re-reads from IndexedDB).
  if (event.data && event.data.type === 'pack-changed') {
    cachedManifest = null
    cachedManifestAt = 0
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
