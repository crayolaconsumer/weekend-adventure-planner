import { isSearchCrawler } from '../../lib/bots.js'
import { isLoadTest } from '../../lib/loadtest.js'
import { logPlaces } from '../../lib/placesLog.js'
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
import { trimOverpassResponse } from '../../lib/overpassTrim.js'
import { getFlags, peekFlags, isFeatureEnabled } from '../../lib/flags.js'
import { parseQuery, getPois, isCovered, getPoiGen, peekPoiGen, POI_DEADLINE_MS } from '../../lib/poiQuery.js'
import { applyRateLimit, applySharedRateLimit, dropRateLimitHeaders } from '../../lib/rateLimit.js'
import { snapQueryBbox } from '../../lib/bboxSnap.js'
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
// Same idea across every instance (the limit above is per instance)
// Per IP across instances; generous because carrier NAT and campus Wi-Fi
// put many real users behind one address
const OVERPASS_SHARED_LIMIT = { max: 300, windowSec: 60 }

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
// Endpoint set reviewed 2026-09 (live-tested while Discover was empty):
//  - overpass.openstreetmap.fr — healthy + returns data + CORS; first.
//    A 30km Driving query over Birmingham takes ~18s here.
//  - overpass-api.de — canonical FOSSGIS; flaky under load (504/406).
//  - REMOVED overpass.osm.ch — it only holds SWISS data (Zurich bbox:
//    193 cafes; Birmingham/Houghton Regis: 0). Its instant empty 200s
//    for every UK query were misread as a "degraded" mirror.
//  - REMOVED overpass.private.coffee (timed out >300s in testing) and
//    earlier maps.mail.ru (suspended 2026-03-16, 403).
// 2 × PER_ENDPOINT_TIMEOUT_MS (28s) = 56s, inside the 60s maxDuration.
const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
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

// Self-built POI table (api/lib/poiQuery.js). The flags fail CLOSED: if they
// can't be read, 0% of tiles touch the DB and today's path serves. Fresh
// cached values are used synchronously; otherwise each KV read gets 50 ms (it
// carries on and fills its cache for the next request), so a KV hit never
// waits long on the flag store. With both percentages at 0 the generation
// isn't read at all.
const POI_FLAGS_WAIT_MS = 50
const POI_OFF = { serve: 0, shadow: 0, gen: 0 }
function within(promise, ms) {
  let timer
  const late = new Promise(resolve => { timer = setTimeout(resolve, ms, null) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
async function poiFlags() {
  try {
    const flags = peekFlags() || await within(getFlags(), POI_FLAGS_WAIT_MS)
    if (!flags || !(flags.poiDbPct > 0 || flags.poiShadowPct > 0)) return POI_OFF
    const gen = peekPoiGen() ?? await within(getPoiGen(), POI_FLAGS_WAIT_MS)
    if (gen === null) return POI_OFF
    return { serve: flags.poiDbPct || 0, shadow: flags.poiShadowPct || 0, gen }
  } catch {
    return POI_OFF
  }
}

// Stable per tile, so a tile stays on one side of the rollout (clean A/B)
const rolloutBucket = q => parseInt(hashKey(q).slice(0, 8), 16) % 100

function sendPoiBody(res, db) {
  dropRateLimitHeaders(res)
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
  res.setHeader('X-Places-Source', 'db')
  res.setHeader('X-Places-Build', db.buildId)
  res.status(200)
  // The body is already JSON text; in-process callers (town.js) only have json()
  if (typeof res.send !== 'function') return res.json(JSON.parse(db.body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.send(db.body)
}

// Shadow mode: what would the DB have served for a response we just gave from
// KV or Overpass? Runs after the response (waitUntil), logs one line to compare.
async function poiShadow(plan, key, live, gen) {
  const db = await getPois(plan, key, { useLru: false, gen })
  if (!db) return // not covered, over the row cap, breaker open, or DB error
  const dbIds = new Set(db.ids)
  const jaccard = els => {
    const ids = new Set(els.map(el => `${el.type}/${el.id}`))
    let both = 0
    for (const id of dbIds) if (ids.has(id)) both++
    const union = ids.size + dbIds.size - both
    return union ? Math.round((both / union) * 1000) / 1000 : 1
  }
  // The build keeps only named elements (the app drops unnamed ones anyway),
  // so the like-for-like comparison is against live's named elements
  const named = live.elements.filter(el => el.tags?.name || el.tags?.['name:en'])
  // In the DB but not live: mostly bbox-overlap extras (see poiQuery.js header)
  const namedIds = new Set(named.map(el => `${el.type}/${el.id}`))
  const extra = [...dbIds].filter(id => !namedIds.has(id))
  console.log(JSON.stringify({
    evt: 'poi_shadow', n_live: live.elements.length, n_live_named: named.length, n_db: db.n,
    jaccard_ids: jaccard(named), jaccard_raw: jaccard(live.elements),
    extra_db: extra.length, extra_db_sample: extra.slice(0, 5),
    db_ms: db.ms, build: db.buildId
  }))
}

export default async function handler(req, res) {
  const t0 = Date.now()
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
  const rateLimitError = applyRateLimit(req, res, OVERPASS_RATE_LIMIT, 'overpass_proxy') ||
    await applySharedRateLimit(req, res, OVERPASS_SHARED_LIMIT, 'overpass')
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
  //
  // The bbox is snapped to a ~1 km grid first (see bboxSnap.js): raw GPS
  // coordinates made every user's key unique, so real traffic never hit.
  // The snapped query is also what goes upstream, so the cached body always
  // matches its key. Non-canonical bboxes pass through unchanged.
  const upstreamQuery = snapQueryBbox(query)
  const cacheKey = `overpass:${hashKey(upstreamQuery)}`
  const staleKey = `overpass:stale:${hashKey(upstreamQuery)}`
  // Outage fallback: stale copies saved before grid snapping live under the
  // raw-query key; read those too until the snapped layer refills (7 days)
  const legacyStaleKey = upstreamQuery === query ? null : `overpass:stale:${hashKey(query)}`
  const readStale = async () => {
    const hasPlaces = d => d && Array.isArray(d.elements) && d.elements.length > 0
    const snapped = await cacheGet(staleKey)
    if (hasPlaces(snapped) || !legacyStaleKey) return snapped
    return cacheGet(legacyStaleKey)
  }
  // POI table first, for queries it can answer (parseQuery null = not ours)
  // in the rollout bucket. getPois is null when the bbox isn't covered by the
  // active build, the breaker is open or the DB errored; that, or 0 rows (an
  // id outside the build), falls through to the path below unchanged.
  // Crawlers may use it: it costs Overpass nothing.
  const poiPlan = parseQuery(upstreamQuery)
  const poiPct = poiPlan ? await poiFlags() : POI_OFF
  const poiBucket = poiPlan ? rolloutBucket(upstreamQuery) : 100
  const poiServe = poiBucket < poiPct.serve
  // §8 log fields: rollout bucket (null = not a POI query) and last-known coverage
  // (covered is read when the line is logged, after any coverage load)
  const poiLog = { bucket: poiPlan ? poiBucket : null, get covered() { return Boolean(poiPlan) && isCovered(poiPlan) } }
  if (poiServe) {
    // The DB gets POI_DEADLINE_MS before we use the old path; a query still
    // running carries on, is killed server-side by MAX_EXECUTION_TIME, and
    // counts as a breaker failure in getPois when it was this slow
    const deadlineAt = Date.now() + POI_DEADLINE_MS
    const db = await within(getPois(poiPlan, upstreamQuery, { gen: poiPct.gen, deadlineAt }), Math.max(0, deadlineAt - Date.now()))
    if (db && db.n > 0) {
      logPlaces(req, t0, 'db', db.n, poiLog)
      return sendPoiBody(res, db)
    }
  }
  const shadowPoi = live => {
    if (!poiServe && poiBucket < poiPct.shadow) waitUntil(poiShadow(poiPlan, upstreamQuery, live, poiPct.gen).catch(() => {}))
  }
  if (isCacheEnabled()) {
    const cached = await cacheGet(cacheKey)
    // Only serve a cached entry that actually has places. A degraded
    // Overpass instance can return 200 + zero elements; the success path
    // below never caches that, but we guard here too so any previously
    // poisoned empty entry self-heals on the next request instead of
    // serving an empty Discover for the full 24h TTL.
    if (cached && Array.isArray(cached.elements) && cached.elements.length > 0) {
      dropRateLimitHeaders(res)
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
      res.setHeader('X-Overpass-Cache', 'HIT')
      shadowPoi(cached)
      logPlaces(req, t0, 'kv', cached.elements.length, poiLog)
      return res.status(200).json(cached)
    }
  }

  // Try endpoints in priority order with a short per-endpoint timeout.
  // 28s × 2 endpoints = 56s, fits inside the 60s function budget.
  // Previously each endpoint had a 55s timeout, so if the first picked
  // endpoint was slow we'd burn the entire budget on it and never get
  // to try the others — Vercel killed the function at 60s with 504.
  // Kill-switch: if the `overpassProxy` feature flag is turned OFF (a KV
  // write, no deploy), make ZERO live Overpass calls — serve the 7-day
  // stale copy if we have one, else 503. Lets us instantly shed live
  // upstream load during an incident (runaway cost / OSM IP-ban risk).
  // Reached only on a cache MISS (cache HITs already returned above), and
  // fails OPEN: if the flag read fails or the flag is absent, this is a
  // no-op and the proxy works normally.
  // Crawlers rendering /place and /town pages (1 page/s after the sitemap
  // went out) must never spend the public Overpass servers' tiny quota:
  // they get the same cache-only treatment as the kill-switch.
  // Load tests (api/lib/loadtest.js) likewise never go upstream
  if (isSearchCrawler(req) || isLoadTest(req) || !(await isFeatureEnabled('overpassProxy'))) {
    if (isCacheEnabled()) {
      const staleData = await readStale()
      if (staleData && Array.isArray(staleData.elements) && staleData.elements.length > 0) {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Overpass-Cache', 'STALE')
        res.setHeader('X-Overpass-Fallback', 'killswitch')
        logPlaces(req, t0, 'stale', staleData.elements.length, poiLog)
        return res.status(200).json(staleData)
      }
    }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '120')
    logPlaces(req, t0, '503', 0, poiLog)
    return res.status(503).json({ error: 'Discover temporarily in cache-only mode' })
  }

  let lastError = null
  let emptyResponse = null
  const PER_ENDPOINT_TIMEOUT_MS = 28000

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
        body: `data=${encodeURIComponent(upstreamQuery)}`,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        markEndpointFailed(endpoint)
        lastError = new Error(`Overpass returned ${response.status}`)
        continue
      }

      // Drop the tags no client reads: halves the payload, and the cache copy with it
      const data = trimOverpassResponse(await response.json())

      // A 200 with zero elements is a failure mode (overpass-api.de returns
      // 200 + 0 elements + a "Query timed out" remark when it runs out of
      // time) — NOT a real "no places here", since a healthy mirror
      // returns the data. Treat empty as a
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
      // hits, plus a 7-day "last known good" copy for the never-empty
      // fallback below. Only non-empty results reach here, so we never
      // cache a degraded-empty response.
      if (isCacheEnabled()) {
        waitUntil(cacheSet(cacheKey, data, OVERPASS_CACHE_TTL_SECONDS).catch(() => {}))
        // 7-day outage copy: long enough to ride out an Overpass outage without
        // filling the KV store with month-old tiles
        waitUntil(cacheSet(staleKey, data, 7 * 24 * 60 * 60).catch(() => {}))
      }

      dropRateLimitHeaders(res)
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
      res.setHeader('X-Overpass-Endpoint', endpoint.replace('https://', '').split('/')[0])
      res.setHeader('X-Overpass-Cache', isCacheEnabled() ? 'MISS' : 'BYPASS')
      shadowPoi(data)
      logPlaces(req, t0, 'overpass', data.elements.length, poiLog)
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
  // query (up to 7 days old, written on every success above) instead of 503.
  // A deck of slightly-stale REAL places beats an empty Discover for a
  // paying user during a total Overpass outage. Flagged via header so the
  // degraded mode stays observable in telemetry. Brand-new tiles never
  // fetched before still 503 — that gap is covered by the planned
  // on-device seed floor.
  if (isCacheEnabled()) {
    const staleData = await readStale()
    if (staleData && Array.isArray(staleData.elements) && staleData.elements.length > 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Overpass-Cache', 'STALE')
      res.setHeader('X-Overpass-Fallback', 'stale')
      logPlaces(req, t0, 'stale', staleData.elements.length, poiLog)
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
    logPlaces(req, t0, 'empty', 0, poiLog)
    return res.status(200).json(emptyResponse)
  }

  // Detail kept server-side only — the lastError message can include
  // upstream URLs, timeouts, and infra hints we shouldn't echo to clients.
  res.setHeader('Retry-After', '60')
  logPlaces(req, t0, '503', 0, poiLog)
  return res.status(503).json({
    error: 'Overpass API unavailable',
    message: 'All upstream endpoints failed. Please retry in a moment.'
  })
}
