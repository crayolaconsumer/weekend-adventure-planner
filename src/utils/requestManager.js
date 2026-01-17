/**
 * Request Manager - Production-grade API request handling
 *
 * Features:
 * - Per-source rate limiting
 * - Circuit breaker pattern (disable failing sources temporarily)
 * - Request deduplication (prevent identical concurrent requests)
 * - Automatic recovery with exponential backoff
 */

import { getCache, setCache } from './geoCache'

// Rate limits per data source (requests per minute)
const SOURCE_LIMITS = {
  overpass: { maxPerMinute: 10, minInterval: 6000 },      // 10/min, 6s between
  opentripmap: { maxPerMinute: 20, minInterval: 3000 },   // 20/min, 3s between
  wikipedia: { maxPerMinute: 30, minInterval: 2000 },     // 30/min, 2s between
  nominatim: { maxPerMinute: 1, minInterval: 60000 },     // 1/min (strict policy)
  weather: { maxPerMinute: 60, minInterval: 1000 }        // 60/min
}

// Circuit breaker configuration
const CIRCUIT_CONFIG = {
  failureThreshold: 3,           // Failures before opening circuit
  resetTimeout: [                 // Exponential backoff (ms)
    5 * 60 * 1000,               // 5 minutes after 1st trip
    30 * 60 * 1000,              // 30 minutes after 2nd trip
    2 * 60 * 60 * 1000           // 2 hours after 3rd+ trip
  ],
  halfOpenRequests: 1             // Requests to allow in half-open state
}

// State tracking
const circuitBreakers = new Map()  // source -> { failures, tripCount, disabledUntil, state }
const lastRequestTime = new Map()  // source -> timestamp
const pendingRequests = new Map()  // cacheKey -> Promise
const requestQueue = new Map()     // source -> Promise (rate limit queue)

/**
 * Circuit breaker states
 */
const CircuitState = {
  CLOSED: 'closed',       // Normal operation
  OPEN: 'open',           // Failing, rejecting requests
  HALF_OPEN: 'half_open'  // Testing recovery
}

/**
 * Get or initialize circuit breaker for a source
 */
function getCircuitBreaker(source) {
  if (!circuitBreakers.has(source)) {
    circuitBreakers.set(source, {
      failures: 0,
      tripCount: 0,
      disabledUntil: 0,
      state: CircuitState.CLOSED,
      halfOpenAttempts: 0
    })
  }
  return circuitBreakers.get(source)
}

/**
 * Check if circuit is open (should reject requests)
 */
export function isCircuitOpen(source) {
  const breaker = getCircuitBreaker(source)

  if (breaker.state === CircuitState.CLOSED) {
    return false
  }

  if (breaker.state === CircuitState.OPEN) {
    // Check if we should transition to half-open
    if (Date.now() >= breaker.disabledUntil) {
      breaker.state = CircuitState.HALF_OPEN
      breaker.halfOpenAttempts = 0
      console.log(`[RequestManager] ${source} circuit transitioning to half-open`)
      return false
    }
    return true
  }

  if (breaker.state === CircuitState.HALF_OPEN) {
    // Allow limited requests in half-open state
    return breaker.halfOpenAttempts >= CIRCUIT_CONFIG.halfOpenRequests
  }

  return false
}

/**
 * Record a successful request
 */
export function recordSuccess(source) {
  const breaker = getCircuitBreaker(source)

  if (breaker.state === CircuitState.HALF_OPEN) {
    // Success in half-open → close circuit
    console.log(`[RequestManager] ${source} circuit closed (recovered)`)
    breaker.state = CircuitState.CLOSED
    breaker.failures = 0
    breaker.tripCount = 0
  } else if (breaker.state === CircuitState.CLOSED) {
    // Reset failure count on success
    breaker.failures = 0
  }
}

/**
 * Record a failed request
 */
export function recordFailure(source, isAuthError = false) {
  const breaker = getCircuitBreaker(source)
  breaker.failures++

  // Auth errors trip immediately
  const threshold = isAuthError ? 1 : CIRCUIT_CONFIG.failureThreshold

  if (breaker.failures >= threshold || breaker.state === CircuitState.HALF_OPEN) {
    // Trip the circuit
    breaker.state = CircuitState.OPEN
    breaker.tripCount = Math.min(breaker.tripCount + 1, CIRCUIT_CONFIG.resetTimeout.length)

    const timeout = CIRCUIT_CONFIG.resetTimeout[breaker.tripCount - 1]
    breaker.disabledUntil = Date.now() + timeout

    const minutes = Math.round(timeout / 60000)
    console.warn(`[RequestManager] ${source} circuit OPEN - disabled for ${minutes} minutes (trip #${breaker.tripCount})`)
  }
}

/**
 * Wait for rate limit window
 */
async function waitForRateLimit(source) {
  const limits = SOURCE_LIMITS[source]
  if (!limits) return

  const lastTime = lastRequestTime.get(source) || 0
  const elapsed = Date.now() - lastTime
  const waitTime = Math.max(0, limits.minInterval - elapsed)

  if (waitTime > 0) {
    // Queue behind any pending wait
    const existingQueue = requestQueue.get(source) || Promise.resolve()
    const newQueue = existingQueue.then(() =>
      new Promise(resolve => setTimeout(resolve, waitTime))
    )
    requestQueue.set(source, newQueue)
    await newQueue
  }

  lastRequestTime.set(source, Date.now())
}

/**
 * Main managed fetch function
 *
 * @param {string} source - Data source identifier
 * @param {string} cacheKey - Cache key for this request
 * @param {Function} fetchFn - Async function that performs the actual fetch
 * @param {Object} options - Additional options
 * @returns {Promise<any>} - Fetched data or null if circuit is open
 */
export async function managedFetch(source, cacheKey, fetchFn, options = {}) {
  const { skipCache = false, ttl } = options

  // 1. Check circuit breaker
  if (isCircuitOpen(source)) {
    console.log(`[RequestManager] ${source} circuit open - skipping request`)
    return null
  }

  // 2. Check cache first (unless skipped)
  if (!skipCache) {
    const cached = getCache(cacheKey)
    if (cached !== null) {
      return cached
    }
  }

  // 3. Dedupe concurrent identical requests
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)
  }

  // 4. Rate limit
  await waitForRateLimit(source)

  // 5. Track half-open attempts
  const breaker = getCircuitBreaker(source)
  if (breaker.state === CircuitState.HALF_OPEN) {
    breaker.halfOpenAttempts++
  }

  // 6. Execute with error handling
  const promise = fetchFn()
    .then(data => {
      recordSuccess(source)
      if (data !== null && data !== undefined) {
        setCache(cacheKey, data, ttl)
      }
      return data
    })
    .catch(err => {
      // Check for auth errors
      const isAuthError = err?.status === 401 || err?.status === 403 ||
                          err?.message?.includes('401') || err?.message?.includes('403')
      recordFailure(source, isAuthError)
      throw err
    })
    .finally(() => {
      pendingRequests.delete(cacheKey)
    })

  pendingRequests.set(cacheKey, promise)
  return promise
}

/**
 * Get circuit breaker status for debugging
 */
export function getCircuitStatus() {
  const status = {}
  for (const [source, breaker] of circuitBreakers) {
    status[source] = {
      state: breaker.state,
      failures: breaker.failures,
      tripCount: breaker.tripCount,
      disabledUntil: breaker.disabledUntil > Date.now()
        ? new Date(breaker.disabledUntil).toISOString()
        : null
    }
  }
  return status
}

/**
 * Manually reset a circuit breaker (for testing/admin)
 */
export function resetCircuit(source) {
  const breaker = getCircuitBreaker(source)
  breaker.state = CircuitState.CLOSED
  breaker.failures = 0
  breaker.tripCount = 0
  breaker.disabledUntil = 0
  console.log(`[RequestManager] ${source} circuit manually reset`)
}

/**
 * Clear all caches and reset state (for testing)
 */
export function resetAll() {
  circuitBreakers.clear()
  lastRequestTime.clear()
  pendingRequests.clear()
  requestQueue.clear()
}
