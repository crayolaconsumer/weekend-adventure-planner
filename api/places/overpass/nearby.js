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

// Overpass endpoints with failover.
// All three accept the same query format; we round-robin via
// selectEndpoint() and track per-endpoint health so a slow/unhealthy
// endpoint gets deprioritized for the next 5 min.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
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

  // Try endpoints in priority order with a short per-endpoint timeout.
  // 18s × 3 endpoints = 54s, fits inside the 60s function budget.
  // Previously each endpoint had a 55s timeout, so if the first picked
  // endpoint was slow we'd burn the entire budget on it and never get
  // to try the others — Vercel killed the function at 60s with 504.
  let lastError = null
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
      markEndpointHealthy(endpoint)

      // Return with aggressive caching headers.
      // Upstream Overpass servers cold-cache hit 20+ seconds during peak
      // (Playwright QA observed 22.8s on a Plan-generation request).
      // OSM data changes slowly — a tile worth of POIs is essentially
      // static at the day scale. Bumping the edge cache from 1h to 24h
      // means the FIRST user in an area pays the cold-cache cost, and
      // every user after them in the same 24h window gets a sub-100ms
      // edge hit. SWR window doubled to 48h so stale-but-revalidating
      // also lasts longer.
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
      res.setHeader('X-Overpass-Endpoint', endpoint.replace('https://', '').split('/')[0])
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

  // All attempts failed
  console.error('[Overpass Proxy] All endpoints failed:', lastError?.message)

  // Detail kept server-side only — the lastError message can include
  // upstream URLs, timeouts, and infra hints we shouldn't echo to clients.
  res.setHeader('Retry-After', '60')
  return res.status(503).json({
    error: 'Overpass API unavailable',
    message: 'All upstream endpoints failed. Please retry in a moment.'
  })
}
