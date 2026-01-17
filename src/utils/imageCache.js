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
export async function fetchAndCacheImage(url, placeId = null) {
  // Check cache first
  const cached = await getCachedImage(url)
  if (cached) {
    return URL.createObjectURL(cached)
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
