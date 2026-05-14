/**
 * IndexedDB-based Image Cache
 *
 * Caches images locally for offline support and faster loading.
 * Uses LRU eviction when cache exceeds maximum size.
 */

const DB_NAME = 'roam_images'
const DB_VERSION = 1
const STORE_NAME = 'images'
const MAX_CACHED_IMAGES = 200
const MAX_AGE_DAYS = 7

let dbPromise = null

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function getDB() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB not supported'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
        store.createIndex('lastAccessed', 'lastAccessed', { unique: false })
        store.createIndex('placeId', 'placeId', { unique: false })
        store.createIndex('cachedAt', 'cachedAt', { unique: false })
      }
    }
  })

  return dbPromise
}

/**
 * Get a cached image by URL
 * @param {string} url - Image URL
 * @returns {Promise<Blob|null>}
 */
export async function getCachedImage(url) {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.get(url)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result
        if (result) {
          // Update last accessed time
          result.lastAccessed = Date.now()
          store.put(result)
          resolve(result.blob)
        } else {
          resolve(null)
        }
      }
    })
  } catch (error) {
    console.debug('Image cache get error:', error)
    return null
  }
}

/**
 * Cache an image
 * @param {string} url - Image URL
 * @param {Blob} blob - Image blob
 * @param {string} [placeId] - Associated place ID
 * @returns {Promise<void>}
 */
export async function cacheImage(url, blob, placeId = null) {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    const entry = {
      url,
      blob,
      placeId,
      cachedAt: Date.now(),
      lastAccessed: Date.now()
    }

    return new Promise((resolve, reject) => {
      const request = store.put(entry)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        // Check if we need to evict old entries
        evictOldEntries()
        resolve()
      }
    })
  } catch (error) {
    console.debug('Image cache put error:', error)
  }
}

/**
 * Evict old entries using LRU strategy
 */
async function evictOldEntries() {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    // Count entries
    const countRequest = store.count()

    countRequest.onsuccess = async () => {
      const count = countRequest.result

      if (count > MAX_CACHED_IMAGES) {
        // Get entries sorted by last accessed
        const index = store.index('lastAccessed')
        const request = index.openCursor()
        let deleted = 0
        const toDelete = count - MAX_CACHED_IMAGES + 10 // Delete a few extra

        request.onsuccess = (event) => {
          const cursor = event.target.result
          if (cursor && deleted < toDelete) {
            cursor.delete()
            deleted++
            cursor.continue()
          }
        }
      }

      // Also delete entries older than MAX_AGE_DAYS
      const maxAge = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
      const ageIndex = store.index('cachedAt')
      const range = IDBKeyRange.upperBound(maxAge)
      const ageRequest = ageIndex.openCursor(range)

      ageRequest.onsuccess = (event) => {
        const cursor = event.target.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
    }
  } catch (error) {
    console.debug('Image cache eviction error:', error)
  }
}

/**
 * Get images for a specific place
 * @param {string} placeId - Place ID
 * @returns {Promise<Array<{url: string, blob: Blob}>>}
 */
export async function getPlaceImages(placeId) {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('placeId')

    return new Promise((resolve, reject) => {
      const request = index.getAll(placeId)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || [])
    })
  } catch (error) {
    console.debug('Get place images error:', error)
    return []
  }
}

/**
 * Remove a specific URL from the cache
 * Use this when an image returns 404 to prevent retrying bad URLs
 * @param {string} url - Image URL to invalidate
 * @returns {Promise<void>}
 */
export async function invalidateCachedImage(url) {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.delete(url)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.debug('Invalidate cached image error:', error)
  }
}

/**
 * Clear all cached images
 * @returns {Promise<void>}
 */
export async function clearImageCache() {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.clear()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.debug('Clear image cache error:', error)
  }
}

/**
 * Fetch and cache an image
 * @param {string} url - Image URL
 * @param {string} [placeId] - Associated place ID
 * @returns {Promise<string>} - Object URL for the cached image
 */
// Hosts we know send Access-Control-Allow-Origin and (in most cases)
// won't 302 to a non-CORS host. Anything else we skip fetching and let
// <img src> handle the load directly — the image still renders, but we
// avoid the CORS-error flood + Wikimedia rate-limits (429s) that
// Discover's swipe deck used to trigger by trying to cache every image.
//
// Notably NOT in the list: commons.wikimedia.org (Special:FilePath
// redirects to upload.wikimedia.org without CORS headers on the 302),
// and brand hosts like starbucks.com that don't enable CORS at all.
const CORS_FRIENDLY_HOSTS = [
  'upload.wikimedia.org',
  'images.unsplash.com',
  'source.unsplash.com',
]

function isCacheableImageUrl(url) {
  if (typeof url !== 'string' || !url) return false
  try {
    const parsed = new URL(url, window.location.origin)
    // Same-origin (e.g. /uploads/, Vercel Blob proxied through us) — always fetchable
    if (parsed.origin === window.location.origin) return true
    // Vercel Blob direct (we control the storage, it sends CORS)
    if (parsed.hostname.endsWith('.public.blob.vercel-storage.com')) return true
    return CORS_FRIENDLY_HOSTS.some((host) => parsed.hostname === host)
  } catch {
    return false
  }
}

export async function fetchAndCacheImage(url, placeId = null) {
  // Check cache first
  const cached = await getCachedImage(url)
  if (cached) {
    return URL.createObjectURL(cached)
  }

  // Skip fetch+cache for cross-origin URLs that don't expose CORS — the
  // <img> tag will still load + display them, we just lose the offline
  // cache. Trying to fetch them all produces a flood of CORS errors in
  // the console on every Discover load, and rapid-fires enough requests
  // at Wikimedia Commons that we start seeing 429 Too Many Requests.
  if (!isCacheableImageUrl(url)) {
    return url
  }

  // Fetch the image
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) throw new Error('Failed to fetch image')

    const blob = await response.blob()

    // Cache it
    await cacheImage(url, blob, placeId)

    return URL.createObjectURL(blob)
  } catch (error) {
    console.debug('Fetch and cache image error:', error)
    return url // Fall back to original URL
  }
}

/**
 * Get cache statistics
 * @returns {Promise<{count: number, size: number}>}
 */
export async function getCacheStats() {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const countRequest = store.count()
      let count = 0
      let size = 0

      countRequest.onsuccess = () => {
        count = countRequest.result

        const cursorRequest = store.openCursor()
        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result
          if (cursor) {
            if (cursor.value.blob) {
              size += cursor.value.blob.size
            }
            cursor.continue()
          } else {
            resolve({ count, size })
          }
        }
        cursorRequest.onerror = () => reject(cursorRequest.error)
      }

      countRequest.onerror = () => reject(countRequest.error)
    })
  } catch (error) {
    console.debug('Get cache stats error:', error)
    return { count: 0, size: 0 }
  }
}
