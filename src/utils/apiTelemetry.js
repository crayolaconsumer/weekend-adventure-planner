/**
 * API Telemetry - Performance instrumentation for ROAM
 *
 * Tracks API call performance, failure rates, and query sizes
 * for debugging and optimization.
 *
 * Usage:
 *   import { recordApiCall, getStats } from './apiTelemetry'
 *
 *   // Record a call
 *   recordApiCall({
 *     source: 'overpass',
 *     endpoint: 'https://overpass-api.de/...',
 *     duration: 1234,
 *     status: 'success',
 *     resultCount: 42
 *   })
 *
 *   // Get stats (also available as window.__roamTelemetry in dev)
 *   const stats = getStats()
 */

const MAX_LOG_SIZE = 100
const SLOW_THRESHOLD_MS = 10000

// Telemetry log - circular buffer of recent API calls
const log = []

/**
 * Record an API call for telemetry
 *
 * @param {Object} params
 * @param {string} params.source - Data source (overpass, opentripmap, wikipedia, etc.)
 * @param {string} [params.endpoint] - Specific endpoint URL
 * @param {number} params.duration - Request duration in ms
 * @param {string} params.status - 'success' | 'error' | 'cancelled' | 'timeout'
 * @param {number} [params.resultCount] - Number of results returned
 * @param {string} [params.error] - Error message if failed
 * @param {number} [params.querySize] - Size of query in characters (for Overpass)
 * @param {number} [params.clauseCount] - Number of query clauses (for Overpass)
 */
export function recordApiCall({ source, endpoint, duration, status, resultCount, error, querySize, clauseCount }) {
  const entry = {
    ts: Date.now(),
    source,
    endpoint: endpoint ? truncateEndpoint(endpoint) : null,
    duration,
    status,
    resultCount: resultCount ?? null,
    error: error ?? null,
    querySize: querySize ?? null,
    clauseCount: clauseCount ?? null
  }

  log.push(entry)

  // Keep log bounded
  if (log.length > MAX_LOG_SIZE) {
    log.shift()
  }

  // Console warnings for slow/failed requests
  if (duration > SLOW_THRESHOLD_MS) {
    console.warn(`[API Slow] ${source}: ${duration}ms`, endpoint ? `(${truncateEndpoint(endpoint)})` : '')
  }

  if (error) {
    console.warn(`[API Fail] ${source}:`, error)
  }
}

/**
 * Truncate endpoint URL for logging (remove query params, keep base)
 */
function truncateEndpoint(endpoint) {
  try {
    const url = new URL(endpoint)
    return url.hostname + url.pathname.slice(0, 30)
  } catch {
    return endpoint.slice(0, 50)
  }
}

/**
 * Get aggregated statistics from telemetry log
 *
 * @returns {Object} Stats object with bySource breakdown and recent entries
 */
export function getStats() {
  const bySource = {}

  for (const entry of log) {
    if (!bySource[entry.source]) {
      bySource[entry.source] = {
        total: 0,
        successes: 0,
        failures: 0,
        cancelled: 0,
        timeouts: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        totalResults: 0,
        avgQuerySize: 0,
        avgClauseCount: 0,
        querySizeSum: 0,
        clauseCountSum: 0,
        querySizeCount: 0,
        clauseCountCount: 0
      }
    }

    const s = bySource[entry.source]
    s.total++

    if (entry.status === 'success') {
      s.successes++
      s.totalDuration += entry.duration
      s.minDuration = Math.min(s.minDuration, entry.duration)
      s.maxDuration = Math.max(s.maxDuration, entry.duration)
      if (entry.resultCount !== null) {
        s.totalResults += entry.resultCount
      }
    } else if (entry.status === 'error') {
      s.failures++
    } else if (entry.status === 'cancelled') {
      s.cancelled++
    } else if (entry.status === 'timeout') {
      s.timeouts++
    }

    if (entry.querySize !== null) {
      s.querySizeSum += entry.querySize
      s.querySizeCount++
    }

    if (entry.clauseCount !== null) {
      s.clauseCountSum += entry.clauseCount
      s.clauseCountCount++
    }
  }

  // Calculate averages
  for (const source of Object.keys(bySource)) {
    const s = bySource[source]
    s.avgDuration = s.successes > 0 ? Math.round(s.totalDuration / s.successes) : 0
    s.avgQuerySize = s.querySizeCount > 0 ? Math.round(s.querySizeSum / s.querySizeCount) : 0
    s.avgClauseCount = s.clauseCountCount > 0 ? Math.round(s.clauseCountSum / s.clauseCountCount) : 0
    s.failureRate = s.total > 0 ? ((s.failures / s.total) * 100).toFixed(1) + '%' : '0%'

    // Clean up internal counters
    delete s.totalDuration
    delete s.querySizeSum
    delete s.clauseCountSum
    delete s.querySizeCount
    delete s.clauseCountCount

    if (s.minDuration === Infinity) s.minDuration = 0
  }

  return {
    bySource,
    recent: log.slice(-10).reverse(), // Most recent first
    totalCalls: log.length,
    oldestEntry: log.length > 0 ? new Date(log[0].ts).toISOString() : null
  }
}

/**
 * Get a summary string for quick debugging
 */
export function getSummary() {
  const stats = getStats()
  const lines = ['=== ROAM API Telemetry ===']

  for (const [source, s] of Object.entries(stats.bySource)) {
    lines.push(
      `${source}: ${s.successes}/${s.total} ok, ${s.avgDuration}ms avg, ${s.failureRate} fail`
    )
    if (s.avgClauseCount > 0) {
      lines.push(`  └─ Query: ${s.avgClauseCount} clauses, ${s.avgQuerySize} chars`)
    }
  }

  return lines.join('\n')
}

/**
 * Clear telemetry log
 */
export function clearTelemetry() {
  log.length = 0
}

// Expose telemetry in development for console debugging
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__roamTelemetry = getStats
  window.__roamTelemetrySummary = getSummary
  window.__roamTelemetryClear = clearTelemetry
}
