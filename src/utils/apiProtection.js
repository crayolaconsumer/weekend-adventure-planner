/**
 * API Protection Utilities
 *
 * Prevents API abuse through:
 * - Request deduplication (no duplicate in-flight requests)
 * - Client-side rate limiting
 * - Circuit breaker pattern (stop after repeated failures)
 * - Request timeouts
 * - Input validation
 */

// Track in-flight requests to prevent duplicates
const inFlightRequests = new Map()

// Circuit breaker state per API
const circuitBreakers = new Map()

// Rate limiter state per API
const rateLimiters = new Map()

/**
 * Circuit breaker configuration
 */
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 3,      // Open circuit after 3 failures
  resetTimeout: 5 * 60 * 1000, // Try again after 5 minutes
  halfOpenRequests: 1       // Allow 1 request in half-open state
}

/**
 * Rate limiter configuration per API
 */
const RATE_LIMIT_CONFIG = {
  ticketmaster: { requestsPerSecond: 4, requestsPerMinute: 50 },
  skiddle: { requestsPerSecond: 2, requestsPerMinute: 30 },
  eventbrite: { requestsPerSecond: 2, requestsPerMinute: 30 }
}

/**
 * Default request timeout (10 seconds)
 */
const DEFAULT_TIMEOUT = 10000

/**
 * Validate coordinates are within reasonable bounds
 */
export function validateCoordinates(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { valid: false, error: 'Coordinates must be numbers' }
  }
  if (isNaN(lat) || isNaN(lng)) {
    return { valid: false, error: 'Coordinates cannot be NaN' }
  }
  if (lat < -90 || lat > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90' }
  }
  if (lng < -180 || lng > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180' }
  }
  return { valid: true }
}

/**
 * Validate radius is reasonable
 */
export function validateRadius(radiusKm) {
  if (typeof radiusKm !== 'number' || isNaN(radiusKm)) {
    return { valid: false, error: 'Radius must be a number' }
  }
  if (radiusKm < 1 || radiusKm > 200) {
    return { valid: false, error: 'Radius must be between 1 and 200 km' }
  }
  return { valid: true }
}

/**
 * Get or create circuit breaker for an API
 */
function getCircuitBreaker(apiName) {
  if (!circuitBreakers.has(apiName)) {
    circuitBreakers.set(apiName, {
      state: 'closed', // closed, open, half-open
      failures: 0,
      lastFailure: 0,
      halfOpenAttempts: 0
    })
  }
  return circuitBreakers.get(apiName)
}

/**
 * Check if circuit breaker allows request
 */
export function canMakeRequest(apiName) {
  const breaker = getCircuitBreaker(apiName)

  if (breaker.state === 'closed') {
    return true
  }

  if (breaker.state === 'open') {
    // Check if enough time has passed to try again
    if (Date.now() - breaker.lastFailure >= CIRCUIT_BREAKER_CONFIG.resetTimeout) {
      breaker.state = 'half-open'
      breaker.halfOpenAttempts = 0
      return true
    }
    return false
  }

  if (breaker.state === 'half-open') {
    return breaker.halfOpenAttempts < CIRCUIT_BREAKER_CONFIG.halfOpenRequests
  }

  return false
}

/**
 * Record successful request
 */
export function recordSuccess(apiName) {
  const breaker = getCircuitBreaker(apiName)
  breaker.state = 'closed'
  breaker.failures = 0
  breaker.halfOpenAttempts = 0
}

/**
 * Record failed request
 */
export function recordFailure(apiName) {
  const breaker = getCircuitBreaker(apiName)

  if (breaker.state === 'half-open') {
    // Failed during half-open, go back to open
    breaker.state = 'open'
    breaker.lastFailure = Date.now()
    return
  }

  breaker.failures++
  breaker.lastFailure = Date.now()

  if (breaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    breaker.state = 'open'
    console.warn(`Circuit breaker OPEN for ${apiName} after ${breaker.failures} failures`)
  }
}

/**
 * Get circuit breaker status for debugging
 */
export function getCircuitStatus(apiName) {
  const breaker = getCircuitBreaker(apiName)
  return {
    state: breaker.state,
    failures: breaker.failures,
    canRequest: canMakeRequest(apiName)
  }
}

/**
 * Get or create rate limiter for an API
 */
function getRateLimiter(apiName) {
  if (!rateLimiters.has(apiName)) {
    const config = RATE_LIMIT_CONFIG[apiName] || { requestsPerSecond: 2, requestsPerMinute: 30 }
    rateLimiters.set(apiName, {
      config,
      requests: [],
      lastCleanup: Date.now()
    })
  }
  return rateLimiters.get(apiName)
}

/**
 * Check if rate limit allows request
 */
export function checkRateLimit(apiName) {
  const limiter = getRateLimiter(apiName)
  const now = Date.now()

  // Clean old requests
  limiter.requests = limiter.requests.filter(t => now - t < 60000)

  // Check per-second limit
  const lastSecond = limiter.requests.filter(t => now - t < 1000)
  if (lastSecond.length >= limiter.config.requestsPerSecond) {
    return { allowed: false, reason: 'per-second limit', retryAfter: 1000 }
  }

  // Check per-minute limit
  if (limiter.requests.length >= limiter.config.requestsPerMinute) {
    const oldestInMinute = Math.min(...limiter.requests)
    const retryAfter = 60000 - (now - oldestInMinute)
    return { allowed: false, reason: 'per-minute limit', retryAfter }
  }

  return { allowed: true }
}

/**
 * Record a request for rate limiting
 */
export function recordRequest(apiName) {
  const limiter = getRateLimiter(apiName)
  limiter.requests.push(Date.now())
}

/**
 * Deduplicate in-flight requests
 * Returns existing promise if same request is already in flight
 */
export function deduplicateRequest(key, requestFn) {
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key)
  }

  const promise = requestFn()
    .finally(() => {
      inFlightRequests.delete(key)
    })

  inFlightRequests.set(key, promise)
  return promise
}

/**
 * Fetch with timeout
 */
export async function fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`)
    }
    throw error
  }
}

/**
 * Protected fetch wrapper with all protections
 */
export async function protectedFetch(apiName, url, options = {}) {
  // Check circuit breaker
  if (!canMakeRequest(apiName)) {
    const status = getCircuitStatus(apiName)
    throw new Error(`Circuit breaker ${status.state} for ${apiName}`)
  }

  // Check rate limit
  const rateCheck = checkRateLimit(apiName)
  if (!rateCheck.allowed) {
    throw new Error(`Rate limited (${rateCheck.reason}), retry in ${rateCheck.retryAfter}ms`)
  }

  // Record request for rate limiting
  recordRequest(apiName)

  // Increment half-open attempts if applicable
  const breaker = getCircuitBreaker(apiName)
  if (breaker.state === 'half-open') {
    breaker.halfOpenAttempts++
  }

  try {
    const response = await fetchWithTimeout(url, options)

    if (response.ok) {
      recordSuccess(apiName)
    } else if (response.status >= 500 || response.status === 429) {
      // Server errors and rate limits count as failures
      recordFailure(apiName)
    }

    return response
  } catch (error) {
    recordFailure(apiName)
    throw error
  }
}

/**
 * Reset all circuit breakers (for testing/debugging)
 */
export function resetAllCircuitBreakers() {
  circuitBreakers.clear()
}

/**
 * Get all API statuses for debugging
 */
export function getAllApiStatuses() {
  const statuses = {}
  for (const [name] of circuitBreakers) {
    statuses[name] = getCircuitStatus(name)
  }
  return statuses
}

export default {
  validateCoordinates,
  validateRadius,
  canMakeRequest,
  recordSuccess,
  recordFailure,
  getCircuitStatus,
  checkRateLimit,
  recordRequest,
  deduplicateRequest,
  fetchWithTimeout,
  protectedFetch,
  resetAllCircuitBreakers,
  getAllApiStatuses
}
