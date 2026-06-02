/**
 * Overpass API Proxy with Edge Caching
 *
 * Proxies Overpass requests through Vercel Edge for:
 * - Edge caching (1 hour, stale-while-revalidate for 2 hours)
 * - Better network path (server has faster connection to Overpass endpoints)
 * - Rate limiting and request aggregation
 *
 * POST /api/places/overpass/nearby
 * Body: { query: string }
 */

// Switched from Edge to Node serverless: Edge has a hard 25-30s ceiling
// (depends on plan). Overpass cold-cache hits routinely take 22-28s and
// were returning 504 to the client before the function could respond.
// Node runtime gives us enough headroom for upstream to actually complete
// (maxDuration is set per-route in vercel.json — see "functions" block).
//
// Vercel only accepts "edge", "experimental-edge", or "nodejs" as a
// file-level runtime value — versioned strings like "nodejs22.x" break
// the build. Node.js minor version is pinned at the project level.
export const config = {
  runtime: 'nodejs'
}

import { cacheGet, cacheSet, hashKey, isCacheEnabled } from '../../lib/kvCache.js'
import { isFeatureEnabled } from '../../lib/flags.js'
import { applyRateLimit } from '../../lib/rateLimit.js'
import { waitUntil } from '@vercel/functions'

// Per-IP rate limit for the proxy. The proxy itself is the only thing
// standing between abusive clients and the community-funded Overpass
// servers — without a limit, a single scraper could trivially get our
// Vercel egress IPs banned at the OSM level. 120 req / 5 min is well
// above normal app usage (a Discover load fires 1 request; a user
// flipping travel modes might fire 3-5 in a minute) but kills scraping.
const OVERPASS_RATE_LIMIT = {
  windowMs: 5 * 60 * 1000,
  max: 120,
  blockDurationMs: 10 * 60 * 1000,
}

// KV TTL for cached Overpass responses. OSM data changes at the day
// scale at fastest (new POIs added by mappers), so 24h is a safe
// tradeoff between freshness and upstream load. Matches the
// `s-maxage` header we already advertise to CDN-style intermediaries.
const OVERPASS_CACHE_TTL_SECONDS = 24 * 60 * 60

// Overpass endpoints with failover.
// All accept the same query format; endpointsByPriority() orders them
// healthy-first and tracks per-endpoint health so a slow/unhealthy
// endpoint gets deprioritized for the next 5 min. The handler also
// treats a 200-with-zero-elements as a SOFT failure and fails over to
// the next mirror (see the fetch loop) — a degraded Overpass instance
// returns empty 200s instead of erroring.
//
// Endpoint set reviewed 2026-06 (live-tested while Discover was empty):
//  - overpass.openstreetmap.fr — healthy + returns data + CORS; first.
//  - overpass.osm.ch — fast when healthy, but was returning 200 + ZERO
//    elements (degraded) during the incident; kept, but empty-failover
//    + health tracking now route around it when it does this.
//  - overpass-api.de — canonical FOSSGIS; flaky under load (504/406).
//  - REMOVED overpass.private.coffee (timed out >300s in testing) and
//    earlier maps.mail.ru (suspended 2026-03-16, 403).
// Keep this list at 3 entries: 3 × PER_ENDPOINT_TIMEOUT_MS (18s) = 54s,
// inside the 60s maxDuration. Empty 200s return fast, so failover adds
// little latency.
const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter'
]

// Track endpoint health for load balancing
// NOTE: In Edge Runtime, this Map is not shared across edge locations.
// Each edge node maintains its own health state. This is acceptable because:
// 1. Health tracking is best-effort optimization, not critical functionality
// 2. Endpoints failing in one region may work in another
// 3. The failover logic handles unhealthy endpoints gracefully
const endpointHealth = new Map()

/**
 * Return endpoints in priority order: healthy ones first (most-recently
 * healthy at the front), unhealthy ones at the back as last-resort
 * fallback. The caller iterates this list until one succeeds.
 *
 * Previously this returned a SINGLE randomly-picked healthy endpoint.
 * That was a problem because the caller's retry loop then had to pick
 * again on failure, and the random pick could repeat or land on the
 * one slow endpoint that had eaten the function budget last time.
 */
function endpointsByPriority() {
  const now = Date.now()
  const stale = 5 * 60 * 1000 // 5 min cooldown for failed endpoints

  return [...OVERPASS_ENDPOINTS].sort((a, b) => {
    const aFail = endpointHealth.get(a) || 0
    const bFail = endpointHealth.get(b) || 0
    const aHealthy = !aFail || now - aFail > stale
    const bHealthy = !bFail || now - bFail > stale
    if (aHealthy && !bHealthy) return -1
    if (!aHealthy && bHealthy) return 1
    // Both same health bucket: prefer the one that failed longer ago
    return aFail - bFail
  })
}

/**
 * Mark an endpoint as failed
 */
function markEndpointFailed(endpoint) {
  endpointHealth.set(endpoint, Date.now())
}

/**
 * Mark an endpoint as healthy
 */
function markEndpointHealthy(endpoint) {
  endpointHealth.delete(endpoint)
}

/**
 * Validate Overpass QL query structure and complexity
 * Returns null if valid, or an error message string if invalid
 */
function validateOverpassQuery(query) {
  // Normalize whitespace for easier pattern matching
  const normalizedQuery = query.trim()

  // Check for required output format declaration
  // Valid formats: [out:json], [out:xml], [out:csv], [out:custom], [out:popup]
  const hasOutputFormat = /\[out:(json|xml|csv|custom|popup)\]/.test(normalizedQuery)

  // Check for timeout setting (indicates well-formed query)
  const hasTimeout = /\[timeout:\d+\]/.test(normalizedQuery)

  // Check for essential Overpass QL statements
  // Must have at least one query statement or a recursion/output.
  // Accepts the full type set: node, way, relation, plus the combined
  // shorthands nw (node+way), nr (node+relation), wr (way+relation),
  // and nwr (all three) — all are valid Overpass QL keywords. The
  // production client uses `nw["key"~"..."]` for compact queries, so
  // dropping these shorthands here silently breaks place discovery.
  const hasQueryStatement = /(^|\s|;|\()(node|way|relation|nwr|nw|nr|wr|area)\s*[[({]/.test(normalizedQuery)
  const hasRecursion = /[<>]/.test(normalizedQuery) // Recurse up/down
  const hasOutput = /\bout\b/.test(normalizedQuery) // Output statement

  // Query must have output format OR be a bbox-style query
  const hasBbox = /\[bbox[:[]/.test(normalizedQuery)

  if (!hasOutputFormat && !hasBbox) {
    return 'Invalid Overpass query: missing output format declaration (e.g., [out:json])'
  }

  // Must contain actual query content (not just settings)
  if (!hasQueryStatement && !hasRecursion) {
    return 'Invalid Overpass query: no query statements found (node, way, relation, area)'
  }

  // Must have output statement to return data
  if (!hasOutput) {
    return 'Invalid Overpass query: missing output statement (out)'
  }

  // Complexity checks to prevent resource-intensive queries

  // Count the number of union/difference operations (semicolons typically separate statements)
  const statementCount = (normalizedQuery.match(/;/g) || []).length
  const MAX_STATEMENTS = 50
  if (statementCount > MAX_STATEMENTS) {
    return `Query too complex: ${statementCount} statements exceeds limit of ${MAX_STATEMENTS}`
  }

  // Check for potentially expensive global queries (no area/bbox constraint)
  // These patterns suggest unbounded geographic scope
  const hasGeographicConstraint =
    /\(around:/.test(normalizedQuery) ||     // around filter
    /\[bbox/.test(normalizedQuery) ||         // bbox setting
    /area[[({]/.test(normalizedQuery) ||     // area filter
    /\{\{bbox\}\}/.test(normalizedQuery) ||   // bbox placeholder
    /poly:/.test(normalizedQuery)             // polygon filter

  // If query uses node/way/relation without geographic bounds, it could be global
  const hasUnboundedQuery = /\b(node|way|relation|nwr)\s*\[/.test(normalizedQuery)
  if (hasUnboundedQuery && !hasGeographicConstraint) {
    return 'Invalid Overpass query: queries must include geographic constraints (around, bbox, area, or poly)'
  }

  // Check for dangerous operations that could overload the server
  const hasDangerousPattern =
    /\(\s*\.\s*;\s*>\s*;\s*\)/.test(normalizedQuery) && // Recursive expansion without limits
    !hasTimeout // Without timeout protection

  if (hasDangerousPattern) {
    return 'Invalid Overpass query: recursive expansions require timeout setting'
  }

  // Validate around radius isn't excessively large (max 50km = 50000m)
  const aroundMatches = normalizedQuery.match(/around:(\d+)/g)
  if (aroundMatches) {
    for (const match of aroundMatches) {
      const radius = parseInt(match.split(':')[1], 10)
      if (radius > 50000) {
        return `Invalid Overpass query: around radius ${radius}m exceeds maximum of 50000m (50km)`
      }
    }
  }

  return null // Query is valid
}

// Edge Runtime — manual CORS since this endpoint can't import withCors
// (different module shape than Node Express handlers). Public proxy with
// no auth, so '*' origin is acceptable.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
}

function applyCorsHeaders(res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value)
  }
}

export default async function handler(req, res) {
  applyCorsHeaders(res)

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit by IP. Rejects abusive callers before we spend any
  // server time on validation or upstream fetches. Honest users won't
  // see this — the limit is set well above app-driven usage patterns.
  const rateLimitError = applyRateLimit(req, res, OVERPASS_RATE_LIMIT, 'overpass_proxy')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  // Vercel Node runtime parses JSON automatically when Content-Type is
  // application/json — req.body is already the parsed object. If it
  // isn't (different content-type, edge case), accept that gracefully.
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  const { query } = body

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' })
  }

  // Query size limit to prevent abuse (check early to avoid processing huge strings)
  const MAX_QUERY_SIZE = 10000
  if (query.length > MAX_QUERY_SIZE) {
    return res.status(400).json({ error: 'Query too large', maxSize: MAX_QUERY_SIZE })
  }

  // Validate Overpass QL structure
  const validationError = validateOverpassQuery(query)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  // KV cache check. Browsers + the Vercel edge can't cache POSTs, so
  // every request would otherwise hit Overpass cold. With KV we serve
  // any query we've answered in the last 24h in ~30ms, and only the
  // FIRST caller per unique bbox+types combination pays the 15-25s
  // cold-cache cost. This is the load-bearing protection against OSM
  // IP-banning us as we scale.
  const cacheKey = `overpass:${hashKey(query)}`
  if (isCacheEnabled()) {
    const cached = await cacheGet(cacheKey)
    // Only serve a cached entry that actually has places. A degraded
    // Overpass instance can return 200 + zero elements; the success path
    // below never caches that, but we guard here too so any previously
    // poisoned empty entry self-heals on the next request instead of
    // serving an empty Discover for the full 24h TTL.
    if (cached && Array.isArray(cached.elements) && cached.elements.length > 0) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
      res.setHeader('X-Overpass-Cache', 'HIT')
      return res.status(200).json(cached)
    }
  }

  // Try endpoints in priority order with a short per-endpoint timeout.
  // 18s × 3 endpoints = 54s, fits inside the 60s function budget.
  // Previously each endpoint had a 55s timeout, so if the first picked
  // endpoint was slow we'd burn the entire budget on it and never get
  // to try the others — Vercel killed the function at 60s with 504.
  // Kill-switch: if the `overpassProxy` feature flag is turned OFF (a KV
  // write, no deploy), make ZERO live Overpass calls — serve the 30-day
  // stale copy if we have one, else 503. Lets us instantly shed live
  // upstream load during an incident (runaway cost / OSM IP-ban risk).
  // Reached only on a cache MISS (cache HITs already returned above), and
  // fails OPEN: if the flag read fails or the flag is absent, this is a
  // no-op and the proxy works normally.
  if (!(await isFeatureEnabled('overpassProxy'))) {
    if (isCacheEnabled()) {
      const staleData = await cacheGet(`overpass:stale:${hashKey(query)}`)
      if (staleData && Array.isArray(staleData.elements) && staleData.elements.length > 0) {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Overpass-Cache', 'STALE')
        res.setHeader('X-Overpass-Fallback', 'killswitch')
        return res.status(200).json(staleData)
      }
    }
    res.setHeader('Retry-After', '120')
    return res.status(503).json({ error: 'Discover temporarily in cache-only mode' })
  }

  let lastError = null
  let emptyResponse = null
  const PER_ENDPOINT_TIMEOUT_MS = 18000

  for (const endpoint of endpointsByPriority()) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PER_ENDPOINT_TIMEOUT_MS)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // OSM Foundation Overpass usage policy requires an identifying
          // User-Agent with a contact URL. Without this, OSM operators
          // can (and have) blocked anonymous traffic at the IP range.
          'User-Agent': 'ROAM/1.0 (+https://www.go-roam.uk; support@extrastaff.com)'
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        markEndpointFailed(endpoint)
        lastError = new Error(`Overpass returned ${response.status}`)
        continue
      }

      const data = await response.json()

      // A 200 with zero elements is Overpass's degraded-instance failure
      // mode (osm.ch did exactly this on 2026-06) — NOT a real "no places
      // here", since a healthy mirror returns the data. Treat empty as a
      // SOFT failure: deprioritise this endpoint, remember the empty body
      // as a last resort, and try the next mirror. Crucially we NEVER
      // cache an empty result — caching it previously poisoned the tile
      // for 24h and kept Discover empty long after Overpass recovered.
      if (!Array.isArray(data.elements) || data.elements.length === 0) {
        markEndpointFailed(endpoint)
        emptyResponse = data
        lastError = new Error(`Overpass returned 0 elements (degraded: ${endpoint})`)
        console.warn(`[Overpass Proxy] 0 elements from ${endpoint} — failing over`)
        continue
      }

      markEndpointHealthy(endpoint)

      // Persist to KV so subsequent callers in the 24h window get cache
      // hits, plus a 30-day "last known good" copy for the never-empty
      // fallback below. Only non-empty results reach here, so we never
      // cache a degraded-empty response.
      if (isCacheEnabled()) {
        waitUntil(cacheSet(cacheKey, data, OVERPASS_CACHE_TTL_SECONDS).catch(() => {}))
        waitUntil(cacheSet(`overpass:stale:${hashKey(query)}`, data, 30 * 24 * 60 * 60).catch(() => {}))
      }

      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
      res.setHeader('X-Overpass-Endpoint', endpoint.replace('https://', '').split('/')[0])
      res.setHeader('X-Overpass-Cache', isCacheEnabled() ? 'MISS' : 'BYPASS')
      return res.status(200).json(data)

    } catch (error) {
      markEndpointFailed(endpoint)
      lastError = error

      // If it's an abort (timeout), try next endpoint
      if (error.name === 'AbortError') {
        console.warn(`[Overpass Proxy] Timeout on ${endpoint}`)
        continue
      }

      console.error(`[Overpass Proxy] Error on ${endpoint}:`, error.message)
    }
  }

  // All attempts failed.
  console.error('[Overpass Proxy] All endpoints failed:', lastError?.message)

  // Never-empty fallback: serve the last known good result for this exact
  // query (up to 30d old, written on every success above) instead of 503.
  // A deck of slightly-stale REAL places beats an empty Discover for a
  // paying user during a total Overpass outage. Flagged via header so the
  // degraded mode stays observable in telemetry. Brand-new tiles never
  // fetched before still 503 — that gap is covered by the planned
  // on-device seed floor.
  if (isCacheEnabled()) {
    const staleData = await cacheGet(`overpass:stale:${hashKey(query)}`)
    if (staleData && Array.isArray(staleData.elements) && staleData.elements.length > 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Overpass-Cache', 'STALE')
      res.setHeader('X-Overpass-Fallback', 'stale')
      return res.status(200).json(staleData)
    }
  }

  // If every mirror responded but they all returned a valid, EMPTY 200
  // (and we have no stale data), return that empty result rather than a
  // 503 — a genuinely empty area is not an outage, and the client still
  // merges Wikipedia/OTM. Not cached (no-store) so it re-checks next time
  // in case the emptiness was transient degradation rather than reality.
  if (emptyResponse) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Overpass-Cache', 'EMPTY')
    return res.status(200).json(emptyResponse)
  }

  // Detail kept server-side only — the lastError message can include
  // upstream URLs, timeouts, and infra hints we shouldn't echo to clients.
  res.setHeader('Retry-After', '60')
  return res.status(503).json({
    error: 'Overpass API unavailable',
    message: 'All upstream endpoints failed. Please retry in a moment.'
  })
}
