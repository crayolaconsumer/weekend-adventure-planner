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

import { cacheGet, cacheSet, hashKey, isCacheEnabled, getClient } from '../../lib/kvCache.js'
import { trimOverpassResponse } from '../../lib/overpassTrim.js'
import { fetchGeoApifyDogPlaces, mergeDogPlaces, dogCacheKey, fetchGeoapifyPlaces, geoapifyPlacesWorstCase, queryBbox, reserveGeoapifyCredits, reserveGeoapifyForIp, settleGeoapifyCredits, GEOAPIFY_DAILY_CREDIT_CAP, GEOAPIFY_FALLBACK_CREDIT_CAP, GEOAPIFY_DOG_CREDITS } from '../../lib/geoapify.js'
import { inPoiRegion } from '../../../shared/overpassQuery.js'
import { isAuthorizedCron } from '../../lib/cronAuth.js'
import { getFlags, peekFlags, isFeatureEnabled } from '../../lib/flags.js'
import { parseQuery, getPois, poiSlotBusy, shadowPois, isCovered, isRankable, getPoiGen, peekPoiGen, activePoiBuild, POI_DEADLINE_MS, POI_CAP_DEADLINE_MS } from '../../lib/poiQuery.js'
import { tilePois, tilesConfigured, tilesBusy } from '../../lib/poiTiles.js'
import { applyRateLimit, applySharedRateLimit, dropRateLimitHeaders, getRateLimitKey } from '../../lib/rateLimit.js'
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
// Last-known-good copies. Outside the POI DB's region they are also what a returning
// visitor is served at once while a refresh runs (stale-while-revalidate), so they live
// 30 days there; inside it the DB answers and they are only an outage copy.
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60
const WORLD_STALE_TTL_SECONDS = 30 * 24 * 60 * 60
// A GeoApify answer is kept under its own key, read only after the fresh and stale
// Overpass copies miss: Overpass's fuller answer always wins once it lands. 24 h so a
// tile Overpass can't answer at all (Mexico City, 26 Oct) spends credits once a day.
const GEOAPIFY_COPY_TTL_SECONDS = 24 * 60 * 60
const GEOAPIFY_TIMEOUT_MS = 2500
// Single flight for GeoApify per tile: the first visitor calls, the others poll for its copy
// (overpass:ga:<hash>) until it should have landed. The lock outlives the call (2.5 s).
const GEOAPIFY_LOCK_SECONDS = 10
const GEOAPIFY_PEER_WAIT_MS = GEOAPIFY_TIMEOUT_MS + 500
const GEOAPIFY_PEER_POLL_MS = 250
// A call that came back with nothing usable (no mappable places, refused, timed out) leaves a
// marker so the tile doesn't spend again on every visit (critic P1: 5 visits = 15 credits)
const GEOAPIFY_NONE_TTL_SECONDS = 45 * 60

// Single flight across instances: while one request fetches a tile from
// Overpass, the others wait for its answer instead of sending the same query
// (a campaign spike on a new area would otherwise fire it once per request).
// The lock outlives the slowest fetch (2 x 28 s) and is released when it ends.
// It must be >= this function's maxDuration (vercel.json, 60): the release
// has no owner token, so a lock expiring under a live holder could let that
// holder delete the next one's.
const FETCH_LOCK_SECONDS = 60
const WAIT_FOR_PEER_MS = 6000 // under the app's 8 s proxy timeout
// Past POI_CAP_DEADLINE_MS, for a first DB try still ending. Retry worst case 2.5 + 1 + 2.5 s, under the app's 8 s proxy timeout
const POI_SETTLE_GRACE_MS = 1000
const PEER_POLL_MS = 500
const hasPlaces = d => Boolean(d) && Array.isArray(d.elements) && d.elements.length > 0

// true when this request should fetch: it won the lock, or KV can't say (fetch as before)
async function claimFetch(lockKey) {
  const client = getClient()
  if (!client) return true
  try {
    return (await client.set(lockKey, '1', { nx: true, ex: FETCH_LOCK_SECONDS })) === 'OK'
  } catch {
    return true
  }
}

// false only when KV says the lock is gone; unknown counts as held (keep waiting)
async function lockHeld(lockKey) {
  try {
    return (await getClient()?.exists(lockKey)) !== 0
  } catch {
    return true
  }
}

function releaseFetch(lockKey, after = Promise.resolve()) {
  const client = getClient()
  if (client) waitUntil(after.catch(() => {}).then(() => client.del(lockKey)).catch(() => {}))
}

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
//  - 2026-10-17: overpass.openstreetmap.fr went white-list only (403) and
//    overpass-api.de answered "at capacity" 502s; maps.mail.ru is back
//    (Luton 2 km deck: 200, 357 elements, ~11 s, sends ACAO) so it's re-added.
// 2 × PER_ENDPOINT_TIMEOUT_MS (28s) = 56s, inside the 60s maxDuration.
const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
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
const POI_OFF = { serve: 0, shadow: 0, cap: 0, gen: 0, tiles: 0, tilesShadow: 0, tilesFallback: false }
// Static tiles (api/lib/poiTiles.js, R2). Tiles-first waits this long before the DB path takes
// over (an answer that slow also counts against the tiles breaker, TILES_SLOW_MS). As the DB's
// fallback they start once the DB's first wait passes with no answer, and are awaited until
// TILES_FALLBACK_BY_MS into the request (at least TILES_FALLBACK_MIN_MS): under the app's 8 s
// proxy timeout, where public Overpass would take 20-56 s (26 Oct 18:46)
export const TILES_FIRST_MS = 1500
const TILES_FALLBACK_BY_MS = 6500
const TILES_FALLBACK_MIN_MS = 500
/** How long the DB's tiles fallback is still waited for, `elapsed` ms into the request. */
export const tilesFallbackWaitMs = elapsed => Math.max(TILES_FALLBACK_MIN_MS, TILES_FALLBACK_BY_MS - elapsed)
function within(promise, ms) {
  let timer
  const late = new Promise(resolve => { timer = setTimeout(resolve, ms, null) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
async function poiFlags() {
  try {
    const flags = peekFlags() || await within(getFlags(), POI_FLAGS_WAIT_MS)
    if (!flags || !(flags.poiDbPct > 0 || flags.poiShadowPct > 0 || flags.poiTilesPct > 0)) return POI_OFF
    const gen = peekPoiGen() ?? await within(getPoiGen(), POI_FLAGS_WAIT_MS)
    if (gen === null) return POI_OFF
    return { serve: flags.poiDbPct || 0, shadow: flags.poiShadowPct || 0, cap: flags.poiCapPct || 0, gen,
      tiles: flags.poiTilesPct || 0, tilesShadow: flags.poiTilesShadowPct || 0, tilesFallback: flags.poiTilesFallback !== false }
  } catch {
    return POI_OFF
  }
}

// Stable per tile, so a tile stays on one side of the rollout (clean A/B)
const rolloutBucket = q => parseInt(hashKey(q).slice(0, 8), 16) % 100

function sendPoiBody(res, db, src = 'db') {
  dropRateLimitHeaders(res)
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
  res.setHeader('X-Places-Source', src)
  res.setHeader('X-Places-Build', db.buildId)
  res.status(200)
  // The body is already JSON text; in-process callers (town.js) only have json()
  if (typeof res.send !== 'function') return res.json(JSON.parse(db.body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.send(db.body)
}

// Shadow mode: what would the DB have served (capped, for a dense Discover tile on a
// features build, whatever poiCapPct serves) for a response we just gave, from KV,
// Overpass or the DB itself (liveSrc)? Runs after the response (waitUntil) on its
// own connection, only while the instance is idle, at most once per tile per 10 min
// (poiQuery shadowPois): it never touches served traffic. Logs one line to compare.
// `live` may be a function, so a served DB body is only parsed when compared.
async function poiShadow(plan, key, live, gen, liveSrc) {
  const db = await shadowPois(plan, key, { gen })
  if (!db) return // not covered, busy, seen recently, over the row cap, or DB error
  if (typeof live === 'function') live = live()
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
    evt: 'poi_shadow', live_src: liveSrc, n_live: live.elements.length, n_live_named: named.length, n_db: db.n,
    jaccard_ids: jaccard(named), jaccard_raw: jaccard(live.elements),
    extra_db: extra.length, extra_db_sample: extra.slice(0, 5),
    db_ms: db.ms, build: db.buildId,
    // A capped answer is a subset of the full one by design: its jaccard_ids is ~n_db/n_live,
    // so the rollout gate reads jaccard on capped: false lines and extra_db on all of them
    capped: db.scanned > db.n, n_scanned: db.scanned ?? db.n, rank_ms: db.rankMs ?? null,
    // phase timings (ms) of a run that probed for the cap: probe (ix_rank, no el), candidates
    // (phase 1), rank, el (phase 2), and today's statement when it served instead
    probe_ms: db.timings?.probe ?? null, candidates_ms: db.timings?.candidates ?? null,
    el_ms: db.timings?.el ?? null, today_ms: db.timings?.today ?? null, cap_fallback: db.capFallback ?? null
  }))
}

const idJaccard = (a, b) => {
  const A = new Set(a)
  let both = 0
  for (const id of b) if (A.has(id)) both++
  const union = A.size + new Set(b).size - both
  return union ? Math.round((both / union) * 1000) / 1000 : 1
}

// Tiles shadow (poiTilesShadowPct): the tiles' answer for a body the DB just served, from
// the DB's own build (exactly: never another), capped exactly when the DB's was, compared byte
// for byte. After the response (waitUntil); never served. A repeat while the tile's answer is in
// the tiles LRU (16 MB, per instance) is a hit (tiles_cached): no R2 read, no decode.
async function poiTilesShadow(plan, key, db) {
  const trace = {}
  const started = Date.now()
  const t = await tilePois(plan, key, { cap: Boolean(db.capPath), buildId: db.buildId, exact: true, trace })
  console.log(JSON.stringify({
    evt: 'poi_tiles_shadow', kind: plan.kind, db_build: db.buildId, tiles_build: t?.buildId ?? null,
    n_db: db.n, n_tiles: t?.n ?? null, bytes_equal: Boolean(t) && t.body === db.body, jaccard: t ? idJaccard(db.ids, t.ids) : null,
    tiles_ms: Date.now() - started, db_ms: db.ms, db_cached: Boolean(db.cached), tiles_cached: Boolean(trace.cached),
    bytes_read: trace.bytesRead ?? null, reads: trace.reads ?? null, why: t ? null : trace.why ?? null
  }))
}

// Fetch a tile from the Overpass mirrors; the caller holds its lock. A success writes the
// fresh and stale copies and releases the lock once the fresh copy lands; a failure releases
// it at once. Never throws: { data, endpoint } or { empty, error } (empty: a mirror's 200 with
// no elements, the last resort below). t0 is the request's start, for the 60 s budget.
// Try endpoints in priority order with a short per-endpoint timeout: 28 s x 2 endpoints
// fits the 60 s function budget (a 55 s timeout used to burn it all on one slow mirror).
const PER_ENDPOINT_TIMEOUT_MS = 28000
// Overpass's busy 5xx comes back in seconds, and a second try usually lands
// (7 Oct: alternate tries of one town query failed and passed). One fast 5xx
// gets one retry, which still fits the town page's 27 s budget. A 429 means
// slow down and a timeout has spent the time: neither is retried
const RETRY_IF_FAILED_WITHIN_MS = 12000

// After a failed worldwide fetch: no new Overpass attempt for this tile until it expires, so a
// failing tile costs Overpass at most one attempt per window however many visitors arrive
// (critic P5: 10 visitors on a 429ing tile = 20 requests). Longer when Overpass said 429.
// It grows for a tile Overpass keeps failing (timeouts count like any failure): 2, 4, 8 ... min,
// capped at 1 h, so a tile Overpass never answers isn't retried every 2 min all day. The count
// lives 6 h and a success clears it. A 429 never backs off for less than 5 min.
const BACKOFF_SECONDS = 120
const BACKOFF_MAX_SECONDS = 60 * 60
const BACKOFF_429_SECONDS = 300
const BACKOFF_COUNT_TTL_SECONDS = 6 * 60 * 60
export function backoffSeconds(failures, rateLimited) {
  const grown = Math.min(BACKOFF_SECONDS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_SECONDS)
  return rateLimited ? Math.max(BACKOFF_429_SECONDS, grown) : grown
}
// A tile too big for KV stays too big: refetch it at most every 30 min
const BACKOFF_UNCACHEABLE_SECONDS = 30 * 60

async function fetchOverpass(upstreamQuery, keys, t0) {
  let lastError = null
  let emptyResponse = null
  let rateLimited = false
  const attempts = endpointsByPriority()
  const loopStart = Date.now()
  let retried = false

  for (const endpoint of attempts) {
    try {
      const controller = new AbortController()
      // Never past the 60 s maxDuration: the DB wait above can spend up to ~6 s of it
      const timeoutId = setTimeout(() => controller.abort(), Math.min(PER_ENDPOINT_TIMEOUT_MS, Math.max(1000, 57000 - (Date.now() - t0))))

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
        if (response.status === 429) rateLimited = true
        lastError = new Error(`Overpass returned ${response.status}`)
        if (response.status >= 500 && !retried && Date.now() - loopStart < RETRY_IF_FAILED_WITHIN_MS) {
          retried = true
          attempts.push(endpoint)
        }
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
        const wrote = cacheSet(keys.cacheKey, data, OVERPASS_CACHE_TTL_SECONDS).catch(() => false)
        // Worldwide, a tile KV refused (over the payload cap) would otherwise be refetched on
        // every visit, since nothing fresh ever lands (critic P3): back off it like a failure
        const cachedFresh = keys.backoffKey
          ? wrote.then(ok => ok === false && getClient()?.set(keys.backoffKey, '1', { ex: BACKOFF_UNCACHEABLE_SECONDS })).catch(() => {})
          : wrote
        waitUntil(cachedFresh)
        releaseFetch(keys.lockKey, cachedFresh) // after the copy peers are polling for lands
        // Answered: the next failure of this tile starts its back-off from 2 min again
        if (keys.backoffCountKey) waitUntil(Promise.resolve(getClient()?.del(keys.backoffCountKey)).catch(() => {}))
        // Outage copy: 7 days in the DB's region, 30 outside it (STALE_TTL_SECONDS)
        waitUntil(cacheSet(keys.staleKey, data, keys.staleTtl).catch(() => {}))
      }
      return { data, endpoint }

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

  console.error('[Overpass Proxy] All endpoints failed:', lastError?.message)
  // The back-off is written before the lock goes, so no visitor sees neither
  if (keys.backoffKey) {
    const client = getClient()
    const backoff = client
      ? (async () => {
          const failures = Number(await client.incr(keys.backoffCountKey)) || 1
          await client.expire(keys.backoffCountKey, BACKOFF_COUNT_TTL_SECONDS)
          await client.set(keys.backoffKey, '1', { ex: backoffSeconds(failures, rateLimited) })
        })().catch(() => client.set(keys.backoffKey, '1', { ex: backoffSeconds(1, rateLimited) }).catch(() => {}))
      : Promise.resolve()
    waitUntil(backoff)
    releaseFetch(keys.lockKey, backoff)
  } else releaseFetch(keys.lockKey)
  return { empty: emptyResponse, error: lastError, rateLimited }
}

// The first promise to resolve truthy; null once all have resolved falsy (a rejection is falsy)
function firstAnswer(promises) {
  const live = promises.filter(Boolean)
  return new Promise(resolve => {
    let left = live.length
    if (!left) resolve(null)
    for (const p of live) {
      p.then(v => v, () => null).then(v => {
        if (v) resolve(v)
        else if (--left === 0) resolve(null)
      })
    }
  })
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

  // Bring-the-dog: GeoApify dog places ride as synthetic elements on every
  // Overpass-shaped serve. The dog cache read starts now, alongside the DB step, as before.
  // The paid part (the reservations and the GeoApify call) starts only once dogs will likely be
  // merged: when the DB's first wait has passed with no answer, or once the DB step is past.
  // DB-served bodies never merge dogs, so a DB that answers in its first wait never spends on them.
  const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY
  const dogMode = body.dogs === true && Boolean(GEOAPIFY_API_KEY) &&
    Number.isFinite(body.lat) && Number.isFinite(body.lng) &&
    Number.isFinite(body.radius) && body.radius > 0 && body.radius <= 100000
  const dogCategory = typeof body.category === 'string' ? body.category : null
  const dogKey = dogMode ? dogCacheKey(body.lat, body.lng, body.radius, dogCategory) : null
  const dogCached = dogMode ? cacheGet(dogKey).catch(() => null) : null
  let dogPromise = null
  const startDogs = () => (dogPromise ??= dogMode
    ? (async () => {
        const category = dogCategory
        const key = dogKey
        const cached = await dogCached
        if (Array.isArray(cached)) return cached
        // Same free-tier credits as the places fallback, so the same hard ceiling (geoapify.js).
        // The whole worst case (3) is kept, never refunded: fetchGeoApifyDogPlaces returns null
        // alike for a refusal, a timeout and a dropped connection, and [] alike for an empty answer
        // and one whose places all lacked dogs.yes, so it can't say what GeoApify billed. Keeping
        // 3 errs toward the cap, never toward charges.
        // Per-IP allowance first (its own counter), so one client can't drain the shared credits
        const client = getClient()
        const ipReservation = await reserveGeoapifyForIp(client, getRateLimitKey(req), 'dogs')
        if (!ipReservation) return []
        if (!(await reserveGeoapifyCredits(client, GEOAPIFY_DOG_CREDITS, GEOAPIFY_DAILY_CREDIT_CAP))) {
          waitUntil(settleGeoapifyCredits(client, ipReservation, 0)) // no call made: the visitor keeps it
          return []
        }
        const p = await fetchGeoApifyDogPlaces({ lat: body.lat, lng: body.lng, radius: body.radius, category, apiKey: GEOAPIFY_API_KEY })
        if (p?.length && isCacheEnabled()) cacheSet(key, p, OVERPASS_CACHE_TTL_SECONDS).catch(() => {})
        return p || []
      })()
    : Promise.resolve([]))

  // The KV tile stores the plain Overpass body; dogs are merged per request
  const sendPlaces = async (data, src, log) => {
    const elements = dogMode ? mergeDogPlaces(data.elements, await startDogs()) : data.elements
    logPlaces(req, t0, src, elements.length, log)
    return res.status(200).json({ ...data, elements })
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
  // Outside the POI DB's region (GB + Ireland) nothing local answers a tile, and public
  // Overpass takes 20-50 s there or fails (26 Oct: Sydney 53 s, Cape Town 503 after 28 s).
  // The DB step is skipped there: it can't cover the tile, and on a cold instance its
  // coverage load and cap wait could spend seconds of the first-visit budget finding that out
  const bbox = queryBbox(upstreamQuery)
  const outsideDb = Boolean(bbox) && !inPoiRegion((bbox.s + bbox.n) / 2, (bbox.w + bbox.e) / 2)
  const poiPlan = outsideDb ? null : parseQuery(upstreamQuery)
  // A GeoApify stand-in for this tile (worldwide only, below): read after the Overpass copies
  const gaKey = `overpass:ga:${hashKey(upstreamQuery)}`
  const gaNoneKey = `overpass:ganone:${hashKey(upstreamQuery)}`
  const readGaCopy = async () => (outsideDb ? cacheGet(gaKey).then(d => (hasPlaces(d) ? d : null)) : null)
  const poiPct = poiPlan ? await poiFlags() : POI_OFF
  const poiBucket = poiPlan ? rolloutBucket(upstreamQuery) : 100
  const poiServe = poiBucket < poiPct.serve
  // §8 log fields: rollout bucket (null = not a POI query) and last-known coverage
  // (covered is read when the line is logged, after any coverage load)
  const poiLog = { bucket: poiPlan ? poiBucket : null, get covered() { return Boolean(poiPlan) && isCovered(poiPlan) } }
  let prefetched // a KV read made while deciding whether to wait longer for the cap
  const poiCap = poiBucket < poiPct.cap
  // Tiles (api/lib/poiTiles.js): the same answers as the DB, from R2. One helper for both modes;
  // every try leaves tiles_* fields on the places line (tiles_why: why it gave no answer)
  let tilesPending = null
  // The tile answer once it lands, empty included: it is the build's own answer, so the DB's
  // cold-instance retry is not sent for it (the DB would say the same). Only one with rows is
  // served (and ends a DB wait: tilesWin); an empty one takes the old path
  let tilesAnswer = null
  const tryTiles = (mode, opts) => {
    poiLog.tiles_mode = mode
    const trace = {}
    const started = Date.now()
    return tilePois(poiPlan, upstreamQuery, { cap: poiCap, trace, ...opts }).then(t => {
      Object.assign(poiLog, { tiles_ms: Date.now() - started, tiles_cached: Boolean(trace.cached), tiles_bytes: trace.bytesRead ?? 0, ...(!t && { tiles_why: trace.why ?? 'none' }) })
      // An empty answer counts only when it is the DB's own build (same chunks); one from another
      // build (current.json) may lack rows the DB has, so the DB's retry still runs
      if (t && (t.n > 0 || (opts.buildId && t.buildId === opts.buildId))) tilesAnswer = t
      return t
    })
  }
  // Resolves only when tiles have an answer with rows (racing a DB wait against it)
  const tilesWin = () => (tilesPending ? tilesPending.then(t => (t?.n > 0 ? { t } : new Promise(() => {}))) : new Promise(() => {}))
  const dbOrTiles = (query, ms) => within(Promise.race([query.then(d => ({ d })), tilesWin()]), ms).then(r => r?.d ?? null)
  const sendTiles = t => {
    // dogs_started: a GeoApify dog call began (DB slower than its first wait) but tiles bodies
    // never merge dogs, so up to 3 credits went nowhere (as on the DB branch)
    delete poiLog.tiles_why // a slow read that landed after all: served, not timed out
    logPlaces(req, t0, 'tiles', t.n, Object.assign(poiLog, { tiles_build: t.buildId, ...(dogMode && { dogs_started: dogPromise != null }) }))
    return sendPoiBody(res, t, 'tiles')
  }
  // Tiles first (poiTilesPct): the DB is only asked when tiles give no answer. An empty answer
  // is the build's answer (the DB would say the same), so it goes straight to the old path.
  // Only the DB's active build is served (exact): after a rollback (which bumps the
  // generation) tiles follow it; while that build is unknown, the DB path serves instead, with
  // the usual tiles fallback behind it. A tiles-first read slower than TILES_FIRST_MS keeps
  // running as the DB's fallback: if the DB then fails, its late answer still serves
  let tilesEmpty = false
  if (poiPlan && poiBucket < poiPct.tiles) {
    const firstBy = Date.now() + TILES_FIRST_MS
    const buildId = await within(activePoiBuild(poiPct.gen, firstBy), TILES_FIRST_MS)
    let t = null
    let landed = false
    if (buildId) {
      tilesPending = tryTiles('first', { buildId, exact: true }).then(r => { landed = true; return r })
      t = await within(tilesPending, Math.max(0, firstBy - Date.now()))
    } else Object.assign(poiLog, { tiles_mode: 'first', tiles_why: 'no_db_build' })
    if (!t && !landed) poiLog.tiles_why ??= 'timeout'
    // That build has no manifest on R2 (a night the tiles step failed): the fallback makes its own
    // read (current.json, yesterday's tiles) if the DB fails too. Any other miss (R2 error,
    // breaker, not covered) would only fail again: no second read
    if (landed && !t && poiLog.tiles_why === 'no_build') tilesPending = null
    if (t?.n > 0) return sendTiles(t)
    tilesEmpty = t?.n === 0
  }
  if (poiServe && !tilesEmpty) {
    // The DB gets POI_DEADLINE_MS before we use the old path; a query still
    // running carries on, is killed server-side by MAX_EXECUTION_TIME, and
    // counts as a breaker failure in getPois when it was this slow
    // The relevance cap serves only in its own rollout bucket (poiCapPct, fail closed). A plan
    // it may cap gets up to POI_CAP_DEADLINE_MS, but only waits past POI_DEADLINE_MS when KV has
    // nothing: then the fallback is Overpass, which times out on dense tiles
    const cap = poiCap
    const capWait = cap && isRankable(poiPlan)
    const started = Date.now()
    const deadlineAt = started + (capWait ? POI_CAP_DEADLINE_MS : POI_DEADLINE_MS)
    let settled = false
    // Aborted once we stop waiting, so a query still queued for the slot gives up its place
    const poiWait = new AbortController()
    const pending = getPois(poiPlan, upstreamQuery, { gen: poiPct.gen, deadlineAt, cap, signal: poiWait.signal }).finally(() => { settled = true })
    // Slot busy: our query will queue behind another, so read KV meanwhile. A KV hit withdraws
    // it and is served now, not after the wait (the old decline-at-once got there in ~1 ms).
    // Checked after the call: getPois may itself have started a coverage refresh that holds the slot
    const kvEarly = poiSlotBusy() && isCacheEnabled() ? cacheGet(cacheKey).catch(() => null) : null
    // A capped answer holds a transaction (and the metadata lock that makes the loader's
    // RENAME wait) until its ROLLBACK: keep the instance alive until it ends even when we
    // stop waiting, or a suspended instance could hold that lock for hours
    waitUntil(pending.catch(() => {}))
    const firstWait = Math.max(0, started + POI_DEADLINE_MS - Date.now())
    let db = null
    if (kvEarly) {
      const kvHit = kvEarly.then(k => (hasPlaces(k) ? { k } : new Promise(() => {}))) // only a hit ends the race
      const raced = await within(Promise.race([pending.then(d => ({ d })), kvHit]), firstWait)
      if (raced?.k) prefetched = raced.k
      else {
        db = raced?.d ?? null
        if (!db?.n) prefetched = await kvEarly // already read: don't read it again below
      }
    } else db = await within(pending, firstWait)
    // First wait over with no DB answer: the deck will most likely come from KV or Overpass, so
    // the dog call starts now and overlaps the rest of the DB wait (critic round 4 #2: serial
    // DB miss + dog fetch could pass the app's 8 s timeout)
    if (!(db && db.n > 0)) startDogs()
    // No DB answer in its first wait: start the tiles fallback now, so it overlaps the rest of the
    // DB's wait instead of adding to it (a KV copy already in hand is served instead). The DB's
    // build when coverage knows it (getPois loaded it); else current.json's, which beats Overpass
    if (!db && poiPct.tilesFallback && !hasPlaces(prefetched)) {
      tilesPending ??= within(activePoiBuild(poiPct.gen), 100).then(buildId => tryTiles('fallback', { buildId }))
    }
    // From here every DB wait also ends when tiles answer: same rows, and an overloaded DB
    // (26 Oct 18:46) is not sent a second statement for an answer already in hand
    if (!db && capWait && !settled) {
      if (prefetched === undefined) prefetched = isCacheEnabled() ? await cacheGet(cacheKey) : null
      if (!hasPlaces(prefetched)) db = await dbOrTiles(pending, Math.max(0, deadlineAt - Date.now()))
    }
    // A cold instance can spend the first try connecting and loading coverage (7 Oct: London's
    // first request on a new deploy ran out of time, then Overpass timed out on it after 27 s).
    // The connection is warm now: one more try before a fallback that can't answer dense tiles
    // A cold coverage read times out (2.5 s) just after that wait ends (17 Oct: Luton 503): let it finish
    if (!db && capWait && !settled && !hasPlaces(prefetched)) db = await dbOrTiles(pending, POI_SETTLE_GRACE_MS)
    if (!db && capWait && settled) {
      if (prefetched === undefined) prefetched = isCacheEnabled() ? await cacheGet(cacheKey) : null
      // The tiles fallback running: its answer first (bounded by its own timeouts). Only when it
      // has none does the DB get a second statement: an overloaded DB is not asked twice for an
      // answer tiles can give (26 Oct 18:46)
      if (tilesPending && !tilesAnswer && !hasPlaces(prefetched)) await within(tilesPending, POI_CAP_DEADLINE_MS)
      // Slot still busy: a second try would only queue again behind the same statement
      if (!tilesAnswer && !hasPlaces(prefetched) && !poiSlotBusy()) {
        const again = getPois(poiPlan, upstreamQuery, { gen: poiPct.gen, deadlineAt: Date.now() + POI_CAP_DEADLINE_MS, cap, signal: poiWait.signal })
        waitUntil(again.catch(() => {}))
        db = await dbOrTiles(again, POI_CAP_DEADLINE_MS)
      }
    }
    if (db && db.n > 0) {
      // The dog merge is not applied to DB-served bodies: the POI rollout is
      // shadow-only, and merging would need the body parsed back. Add it
      // here when the DB goes primary.
      // dogs_started: a dog call began (DB slower than its first wait) but this body won't merge
      // it, so up to 3 credits went nowhere (critic round 5 #1: measure how often in production)
      logPlaces(req, t0, 'db', db.n, Object.assign(poiLog, { db_scanned: db.scanned ?? db.n, db_cached: db.cached, ...(dogMode && { dogs_started: dogPromise != null }) }))
      const sent = sendPoiBody(res, db)
      shadowPoi(() => JSON.parse(db.body), 'db')
      // Shadow yields to live work: skipped while tile decodes are queued on this instance
      if (poiBucket < poiPct.tilesShadow && tilesConfigured() && !tilesBusy()) waitUntil(poiTilesShadow(poiPlan, upstreamQuery, db).catch(() => {}))
      return sent
    }
    poiWait.abort()
    // The DB failed, timed out or stayed busy (db null; an empty answer is an answer): tiles hold
    // the same rows, so a tile answer in hand beats KV's Overpass copy and Overpass. Still
    // pending: waited for (up to TILES_FALLBACK_BY_MS into the request) only when KV has no
    // copy; with one, KV serves now
    if (!db && tilesPending) {
      const t = tilesAnswer ?? (hasPlaces(prefetched) ? null : await within(tilesPending, tilesFallbackWaitMs(Date.now() - t0)))
      if (!t && !hasPlaces(prefetched)) poiLog.tiles_why ??= 'timeout'
      if (t?.n > 0) return sendTiles(t)
    }
  } else if (tilesPending) {
    // Tiles first with no DB step for this bucket (poiDbPct below poiTilesPct): a slow tiles-first
    // read is still the best answer there is, so it is waited for as the fallback would be
    const t = await within(tilesPending, tilesFallbackWaitMs(Date.now() - t0))
    if (t?.n > 0) return sendTiles(t)
  }
  startDogs() // past the DB step: every serve from here on merges dogs
  // Shadow is sampled on its own (poiShadowPct), whatever the DB rollout: DB answers,
  // KV hits and Overpass answers all get compared, so the cap is measured at any poiDbPct
  function shadowPoi(live, liveSrc) {
    if (poiPlan && poiBucket < poiPct.shadow) waitUntil(poiShadow(poiPlan, upstreamQuery, live, poiPct.gen, liveSrc).catch(() => {}))
  }
  if (isCacheEnabled()) {
    const cached = prefetched !== undefined ? prefetched : await cacheGet(cacheKey)
    // Only serve a cached entry that actually has places. A degraded
    // Overpass instance can return 200 + zero elements; the success path
    // below never caches that, but we guard here too so any previously
    // poisoned empty entry self-heals on the next request instead of
    // serving an empty Discover for the full 24h TTL.
    if (cached && Array.isArray(cached.elements) && cached.elements.length > 0) {
      dropRateLimitHeaders(res)
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
      res.setHeader('X-Overpass-Cache', 'HIT')
      shadowPoi(cached, 'kv')
      return sendPlaces(cached, 'kv', poiLog)
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
        return sendPlaces(staleData, 'stale', poiLog)
      }
      // Still cache-only: a GeoApify copy a visitor's request already paid for, never a call
      const gaCopy = await readGaCopy()
      if (gaCopy) {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Overpass-Fallback', 'killswitch')
        return sendPlaces(gaCopy, 'geoapify', Object.assign(poiLog, { ga_cached: true }))
      }
    }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '120')
    logPlaces(req, t0, '503', 0, poiLog)
    return res.status(503).json({ error: 'Discover temporarily in cache-only mode' })
  }

  const lockKey = `overpass:lock:${hashKey(upstreamQuery)}`
  // backoffKey: worldwide only; in GB a failed fetch releases the lock at once, as before
  const backoffKey = outsideDb ? `overpass:backoff:${hashKey(upstreamQuery)}` : null
  const backoffCountKey = outsideDb ? `overpass:backoffn:${hashKey(upstreamQuery)}` : null
  const keys = { cacheKey, staleKey, lockKey, backoffKey, backoffCountKey, staleTtl: outsideDb ? WORLD_STALE_TTL_SECONDS : STALE_TTL_SECONDS }
  // KV can't say: not backed off (fetch as before)
  const inBackoff = async () => {
    try {
      return (await getClient()?.exists(backoffKey)) > 0
    } catch {
      return false
    }
  }
  const sendOverpass = result => {
    dropRateLimitHeaders(res)
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
    res.setHeader('X-Overpass-Endpoint', result.endpoint.replace('https://', '').split('/')[0])
    res.setHeader('X-Overpass-Cache', isCacheEnabled() ? 'MISS' : 'BYPASS')
    shadowPoi(result.data, 'overpass')
    return sendPlaces(result.data, 'overpass', poiLog)
  }
  // One line per Overpass fetch on the worldwide path, which may finish after the response
  const tracedOverpass = () => fetchOverpass(upstreamQuery, keys, t0).then(r => {
    console.log(JSON.stringify({ evt: 'overpass_fetch', ok: Boolean(r.data), ms: Date.now() - t0, n: r.data?.elements.length ?? 0, error: r.error?.message ?? null }))
    return r
  })

  let won = null // claimed the fetch lock: null = not asked yet
  let result = null // this request's Overpass outcome
  // The prewarm cron (its bearer) waits for Overpass as before: filling KV is its job
  if (outsideDb && !isAuthorizedCron(req)) {
    // Stale-while-revalidate: a last-known-good copy (else a GeoApify one) answers now, and
    // one refresh per tile runs after the response; the lock keeps it to one across instances
    const stale = await readStale()
    const ga = hasPlaces(stale) ? null : await readGaCopy()
    const copy = hasPlaces(stale) ? { data: stale, src: 'stale' } : ga && { data: ga, src: 'geoapify' }
    if (copy) {
      // Lock first, then the back-off: checked the other way round, a peer failing in between
      // (back-off written, lock released) would let one more fetch through (critic P2)
      waitUntil(claimFetch(lockKey).then(async claimed => {
        if (!claimed) return
        if (await inBackoff()) return releaseFetch(lockKey)
        return tracedOverpass()
      }).catch(() => {}))
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Overpass-Cache', 'STALE')
      res.setHeader('X-Overpass-Fallback', 'swr')
      return sendPlaces(copy.data, copy.src, Object.assign(poiLog, { swr: true }))
    }

    // Nothing cached: Overpass and GeoApify race, the first good answer is served. Overpass
    // runs on to completion either way (waitUntil) and its full answer fills KV for next time.
    // GeoApify is asked at once, not after an Overpass deadline: a cold tile out here never
    // came back from Overpass in under 2.5 s, so waiting first would only add latency.
    won = await claimFetch(lockKey)
    if (won && await inBackoff()) {
      poiLog.overpass_backoff = true
      releaseFetch(lockKey)
      won = false
    }
    const overpass = won ? tracedOverpass() : null
    if (overpass) waitUntil(overpass)
    const gaLog = {}
    const geoapify = (async () => {
      const worst = GEOAPIFY_API_KEY ? geoapifyPlacesWorstCase(upstreamQuery) : 0
      const client = getClient()
      if (!worst || !client) return null // no key, a query it can't answer, or KV can't count
      if (await cacheGet(gaNoneKey)) {
        gaLog.ga_none = true // asked recently, nothing usable came back
        return null
      }
      const gaLockKey = `overpass:galock:${hashKey(upstreamQuery)}`
      let mine = false
      try {
        mine = (await client.set(gaLockKey, '1', { nx: true, ex: GEOAPIFY_LOCK_SECONDS })) === 'OK'
      } catch {
        // unknown: don't call, a peer may be
      }
      if (!mine) {
        // Another visitor is asking GeoApify for this tile: wait for its copy, never a second call
        gaLog.ga_peer = true
        for (const until = Date.now() + GEOAPIFY_PEER_WAIT_MS; Date.now() < until;) {
          await new Promise(resolve => setTimeout(resolve, GEOAPIFY_PEER_POLL_MS))
          const held = await lockHeld(gaLockKey)
          const d = await cacheGet(gaKey)
          if (hasPlaces(d)) return d
          if (!held) break // the peer finished without an answer
        }
        return null
      }
      let landed = Promise.resolve()
      try {
        const ipReservation = await reserveGeoapifyForIp(client, getRateLimitKey(req))
        if (!ipReservation) {
          gaLog.ga_ip_capped = true
          return null
        }
        const reservation = await reserveGeoapifyCredits(client, worst, GEOAPIFY_FALLBACK_CREDIT_CAP)
        if (!reservation) {
          gaLog.ga_capped = true
          waitUntil(settleGeoapifyCredits(client, ipReservation, 0)) // no call made: the visitor keeps it
          return null
        }
        const started = Date.now()
        const ga = await fetchGeoapifyPlaces(upstreamQuery, { apiKey: GEOAPIFY_API_KEY, timeoutMs: GEOAPIFY_TIMEOUT_MS })
        // ga_credits: today's count once the unused part is refunded
        Object.assign(gaLog, { ga_ms: Date.now() - started, ga_credits: reservation.total - (worst - ga.credits) })
        waitUntil(settleGeoapifyCredits(client, reservation, ga.credits))
        landed = (ga.data
          ? cacheSet(gaKey, ga.data, GEOAPIFY_COPY_TTL_SECONDS)
          : cacheSet(gaNoneKey, 1, GEOAPIFY_NONE_TTL_SECONDS)).catch(() => {})
        return ga.data
      } finally {
        // Released once the copy peers poll for has landed
        waitUntil(landed.then(() => client.del(gaLockKey)).catch(() => {}))
      }
    })().catch(() => null)
    // Its tail (refund, copy or marker write, lock release) must finish even when Overpass wins
    waitUntil(geoapify)
    const first = await firstAnswer([overpass?.then(r => (r.data ? r : null)), geoapify.then(data => data && { geoapify: data })])
    if (first?.geoapify) {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Overpass-Fallback', 'geoapify')
      return sendPlaces(first.geoapify, 'geoapify', Object.assign(poiLog, gaLog))
    }
    Object.assign(poiLog, gaLog) // ga_credits / ga_capped on the Overpass line too
    if (first) return sendOverpass(first)
    if (overpass) result = await overpass // settled: both failed, so the failure path below
  }

  if (won === null) won = await claimFetch(lockKey)
  if (!won) {
    // Another request is fetching this tile from Overpass. A last-known-good
    // copy answers at once; else wait for the peer's answer while it still
    // holds the lock (a failed fetch releases it at once), never a second call
    let staleData = await readStale()
    const serveStale = async () => {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Overpass-Cache', 'STALE')
      res.setHeader('X-Overpass-Fallback', 'peer')
      return sendPlaces(staleData, 'stale', Object.assign(poiLog, { fallback: 'peer' }))
    }
    if (hasPlaces(staleData)) return serveStale()
    // Worldwide, the GeoApify attempt above already spent up to 3 s: the wait counts from the
    // request's start there, so a visitor is never held past the app's 8 s proxy timeout
    for (const until = (outsideDb ? t0 : Date.now()) + WAIT_FOR_PEER_MS; Date.now() < until;) {
      await new Promise(resolve => setTimeout(resolve, PEER_POLL_MS))
      // Lock first, then answer: a peer writes its answer before releasing, so
      // "released" read first can't miss an answer that has landed
      const held = await lockHeld(lockKey)
      const cached = await cacheGet(cacheKey)
      if (hasPlaces(cached)) {
        dropRateLimitHeaders(res)
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800')
        res.setHeader('X-Overpass-Cache', 'PEER')
        shadowPoi(cached, 'kv')
        return sendPlaces(cached, 'peer', Object.assign(poiLog, { waited_ms: Date.now() - t0 }))
      }
      if (!held) break // the peer failed: no answer is coming
    }
    staleData = await readStale() // the peer may have written one meanwhile
    if (hasPlaces(staleData)) return serveStale()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '10')
    logPlaces(req, t0, '503', 0, Object.assign(poiLog, { waited_ms: Date.now() - t0 }))
    return res.status(503).json({ error: 'Overpass API unavailable', message: 'This area is loading. Please retry in a moment.' })
  }

  if (!result) result = await fetchOverpass(upstreamQuery, keys, t0)
  if (result.data) return sendOverpass(result)
  const emptyResponse = result.empty
  // Tells the prewarm cron Overpass said 429, so it can stop for the night (it only sees our 503)
  if (result.rateLimited) res.setHeader('X-Overpass-Upstream', 'rate-limited')

  // Never-empty fallback: serve the last known good result for this exact
  // query (up to 7 days old, 30 outside the DB's region) instead of 503.
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
      return sendPlaces(staleData, 'stale', poiLog)
    }
  }

  // Last-resort dog fallback: every Overpass mirror failed, no stale copy
  // exists (brand-new tile), but the GeoApify dog fetch succeeded. A deck of
  // real dog-friendly places beats a 503 for a premium user mid-outage —
  // the normal deck cannot be served at all at this point.
  if (dogMode) {
    const dogOnly = await startDogs()
    if (Array.isArray(dogOnly) && dogOnly.length > 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Overpass-Fallback', 'geoapify')
      logPlaces(req, t0, 'geoapify', dogOnly.length, Object.assign(poiLog, { dogs_only: true }))
      return res.status(200).json({ elements: dogOnly })
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
