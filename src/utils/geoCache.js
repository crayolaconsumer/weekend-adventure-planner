/**
 * Geographic Cache - Smart caching for location-based data
 *
 * Features:
 * - In-memory cache with localStorage backup
 * - Geographic bucketing (nearby requests share cache)
 * - TTL-based expiration
 * - Stale-while-revalidate pattern
 */

// Cache configuration
const DEFAULT_TTL = 10 * 60 * 1000  // 10 minutes
const STALE_TTL = 30 * 60 * 1000    // 30 minutes (stale but usable)
const GEO_PRECISION = 3              // Decimal places (~110m buckets)
const MAX_CACHE_SIZE = 100           // Max entries in memory
const STORAGE_PREFIX = 'roam_cache_'

// In-memory cache
const memoryCache = new Map()

/**
 * Cache entry structure
 */
function createEntry(data, ttl = DEFAULT_TTL) {
  return {
    data,
    timestamp: Date.now(),
    expires: Date.now() + ttl,
    staleUntil: Date.now() + STALE_TTL
  }
}

/**
 * Check if entry is fresh (not expired)
 */
function isFresh(entry) {
  return entry && Date.now() < entry.expires
}

/**
 * Check if entry is stale but usable
 */
function isStale(entry) {
  return entry && Date.now() >= entry.expires && Date.now() < entry.staleUntil
}

/**
 * Check if entry is completely expired
 */
function isExpired(entry) {
  return !entry || Date.now() >= entry.staleUntil
}

/**
 * Check if usable cache exists (fresh or stale)
 * Use this for synchronous checks before showing loading state
 * @param {string} key - Cache key
 * @returns {{exists: boolean, stale: boolean, data: any|null}}
 */
export function hasCacheSync(key) {
  // Check memory first
  let entry = memoryCache.get(key)

  // Fall back to localStorage
  if (!entry) {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key)
      if (stored) {
        entry = JSON.parse(stored)
        // Restore to memory cache if usable
        if (!isExpired(entry)) {
          memoryCache.set(key, entry)
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  if (!entry || isExpired(entry)) {
    return { exists: false, stale: false, data: null }
  }

  if (isFresh(entry)) {
    return { exists: true, stale: false, data: entry.data }
  }

  if (isStale(entry)) {
    return { exists: true, stale: true, data: entry.data }
  }

  return { exists: false, stale: false, data: null }
}

/**
 * Get data from cache
 * @param {string} key - Cache key
 * @returns {any|null} - Cached data or null
 */
export function getCache(key) {
  // Check memory first
  let entry = memoryCache.get(key)

  // Fall back to localStorage
  if (!entry) {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key)
      if (stored) {
        entry = JSON.parse(stored)
        // Restore to memory cache
        if (!isExpired(entry)) {
          memoryCache.set(key, entry)
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  if (!entry || isExpired(entry)) {
    return null
  }

  return entry.data
}

/**
 * Set data in cache
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in ms (optional)
 */
export function setCache(key, data, ttl = DEFAULT_TTL) {
  const entry = createEntry(data, ttl)

  // Evict oldest entries if at capacity
  if (memoryCache.size >= MAX_CACHE_SIZE) {
    evictOldest()
  }

  memoryCache.set(key, entry)

  // Backup to localStorage (async to not block)
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // localStorage might be full, try to clear old entries
    clearExpiredFromStorage()
  }
}

/**
 * Get with stale-while-revalidate pattern
 *
 * Returns cached data immediately (even if stale) and optionally
 * refreshes in background
 *
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch fresh data
 * @param {Object} options - Options
 * @returns {Promise<{data: any, fresh: boolean, stale: boolean}>}
 */
export async function getWithSWR(key, fetchFn, options = {}) {
  const { ttl = DEFAULT_TTL, onBackgroundRefresh } = options

  let entry = memoryCache.get(key)

  // Try localStorage if not in memory
  if (!entry) {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key)
      if (stored) {
        entry = JSON.parse(stored)
      }
    } catch {
      // Ignore
    }
  }

  // Fresh cache hit
  if (entry && isFresh(entry)) {
    return { data: entry.data, fresh: true, stale: false }
  }

  // Stale cache - return immediately, refresh in background
  if (entry && isStale(entry)) {
    // Background refresh (fire and forget)
    fetchFn()
      .then(freshData => {
        setCache(key, freshData, ttl)
        if (onBackgroundRefresh) {
          onBackgroundRefresh(freshData)
        }
      })
      .catch(err => {
        console.warn('[GeoCache] Background refresh failed:', err)
      })

    return { data: entry.data, fresh: false, stale: true }
  }

  // No cache or completely expired - must fetch
  try {
    const data = await fetchFn()
    setCache(key, data, ttl)
    return { data, fresh: true, stale: false }
  } catch (err) {
    // If fetch fails and we have stale data, use it
    if (entry) {
      return { data: entry.data, fresh: false, stale: true }
    }
    throw err
  }
}

/**
 * Create a cache key for geographic queries
 *
 * Rounds coordinates to create "buckets" so nearby requests
 * can share cached results
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radius - Search radius
 * @param {string|null} category - Category filter
 * @returns {string} Cache key
 */
export function makeCacheKey(lat, lng, radius, category = null) {
  const latBucket = lat.toFixed(GEO_PRECISION)
  const lngBucket = lng.toFixed(GEO_PRECISION)
  const cat = category || 'all'
  return `places_${latBucket}_${lngBucket}_${radius}_${cat}`
}

/**
 * Create a cache key for any parameters
 * @param {string} prefix - Key prefix
 * @param  {...any} args - Arguments to include in key
 * @returns {string} Cache key
 */
export function makeKey(prefix, ...args) {
  const parts = args.map(arg => {
    if (typeof arg === 'number') {
      return arg.toFixed(GEO_PRECISION)
    }
    if (typeof arg === 'object') {
      return JSON.stringify(arg)
    }
    return String(arg || 'null')
  })
  return `${prefix}_${parts.join('_')}`
}

/**
 * Evict oldest entries from memory cache
 */
function evictOldest() {
  const entries = Array.from(memoryCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)

  // Remove oldest 20%
  const toRemove = Math.ceil(entries.length * 0.2)
  for (let i = 0; i < toRemove; i++) {
    memoryCache.delete(entries[i][0])
  }
}

/**
 * Clear expired entries from localStorage
 */
function clearExpiredFromStorage() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX))

    for (const key of keys) {
      try {
        const entry = JSON.parse(localStorage.getItem(key))
        if (isExpired(entry)) {
          localStorage.removeItem(key)
        }
      } catch {
        // Remove corrupted entries
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Clear all cache (for testing or user-initiated refresh)
 */
export function clearCache() {
  memoryCache.clear()

  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX))
    for (const key of keys) {
      localStorage.removeItem(key)
    }
  } catch {
    // Ignore
  }
}

/**
 * Invalidate cache for a specific pattern
 * @param {string} pattern - Pattern to match (uses startsWith)
 */
export function invalidatePattern(pattern) {
  // Memory cache
  for (const key of memoryCache.keys()) {
    if (key.startsWith(pattern)) {
      memoryCache.delete(key)
    }
  }

  // localStorage
  try {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith(STORAGE_PREFIX + pattern)
    )
    for (const key of keys) {
      localStorage.removeItem(key)
    }
  } catch {
    // Ignore
  }
}

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats() {
  let memorySize = 0
  let freshCount = 0
  let staleCount = 0
  let expiredCount = 0

  for (const entry of memoryCache.values()) {
    memorySize++
    if (isFresh(entry)) freshCount++
    else if (isStale(entry)) staleCount++
    else expiredCount++
  }

  return {
    memorySize,
    freshCount,
    staleCount,
    expiredCount,
    maxSize: MAX_CACHE_SIZE
  }
}

// Clean up expired entries periodically
setInterval(clearExpiredFromStorage, 5 * 60 * 1000)  // Every 5 minutes
