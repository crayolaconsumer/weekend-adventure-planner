/**
 * Answers a small, known subset of Overpass QL from our own `pois` table
 * (see /database/phase11-pois.sql and the POI build job).
 *
 * parseQuery(ql) turns a query the app emits into a plan, or null for anything
 * it doesn't recognise (around:, poly:, area, recursion, unknown keys...). Null
 * means "not ours": the caller takes the legacy KV/Overpass path unchanged.
 *
 * queryPois(plan) runs it and returns the same Overpass JSON envelope the proxy
 * serves today, built by concatenating the stored element strings.
 *
 * getPois(plan, key) is the serving wrapper: active-build coverage, a
 * per-instance circuit breaker, in-flight dedupe and a small LRU. It never
 * throws; null means "use the legacy path".
 *
 * Known differences from Overpass, by design (measured by the shadow log):
 * - (bbox) is matched on the element's bounding box, not its geometry: an
 *   area whose bounds overlap the box while its outline misses it (a park
 *   wrapped round a small box, an L-shaped or diagonal area) is returned here
 *   and not by Overpass. Excluding "bounds wrap the box" was tried and dropped:
 *   it loses concave parks with members inside. The rollout gate is the shadow
 *   log (jaccard_ids >= 0.9, extra_db counts these extras).
 * - The build keeps named elements only. Discover queries without ["name"]
 *   get unnamed elements from Overpass that we never have; the app drops
 *   them anyway (shadow compares named elements: jaccard_ids).
 * - Stored elements carry lat/lon (nodes) or center + bounds (ways, relations)
 *   whatever the `out` mode, so `out tags bb` answers include coordinates
 *   Overpass leaves out. Every parser reads them the same (tested).
 */
import { getPool } from './db.js'
import { cacheGet } from './kvCache.js'
import { cellRanges, CELL_PAD_DEG, LARGE_CELL, OSM_TYPE_CODE, OSM_TYPE_NAME, SCHEMA_VERSION } from '../../shared/poiCell.mjs'
// The build's own osmium filter: a key=value outside it isn't in the table
import { POI_KEYS, filterPairs } from '../../scripts/poi/filter.mjs'

// Must equal poi_builds.schema_version and the build manifest (loader gate G1)
export const POI_SCHEMA_VERSION = SCHEMA_VERSION

const KEYS = new Set(POI_KEYS)
const TYPE_CODES = { node: [1], way: [2], relation: [3], nw: [1, 2], nwr: [1, 2, 3] }
const CENTER_OUTS = new Set(['out center', 'out tags center', 'out body center'])
const VALUE = /^[a-z0-9_]+$/
const MAX_LIMIT = 1000
// key -> Set of values the build keeps
const SUPPORTED = new Map([...filterPairs()].map(([k, vs]) => [k, new Set(vs)]))
// Largest bbox we answer. The app's biggest single query is 75 km (large
// radii are tiled at 35 km): 1.36 deg of latitude, 2.8 deg of longitude at
// Shetland. 100 km fits across mainland UK. Anything bigger takes the old path.
const MAX_LAT_SPAN = 2.5
const MAX_LON_SPAN = 3.5
// Size cap. An answer over MAX_BODY_BYTES is left to the old path rather than
// served truncated (Overpass never truncates). SCAN_ROWS only bounds the scan.
export const MAX_BODY_BYTES = 4_000_000
export const SCAN_ROWS = 12_000
// A query slower than this counts as a breaker failure even if it succeeds:
// the caller (nearby.js) has stopped waiting and served the old path
export const POI_DEADLINE_MS = 1000
// Don't submit SQL with less than this left before the caller's deadline
const MIN_REMAINING_MS = 200
// Server-side bound: MySQL kills the SELECT, so the connection is freed too
// (the mysql2 timeout alone only rejects the promise)
const HINT = '/*+ MAX_EXECUTION_TIME(800) */'
const LRU_MAX_BYTES = 1_000_000
// Collapse whitespace outside quoted strings, so "out  tags\ncenter" and
// "nw[ \"shop\" ]" read the same as the compact forms
function normalise(ql) {
  return ql.replace(/"[^"]*"|\s*([[\](),;=~])\s*|\s+/g, (m, punct) => (m[0] === '"' ? m : punct || ' ')).trim()
}

// Split on `;` outside quotes and brackets: "a;(b;c);d" → ['a', '(b;c)', 'd']
function splitTop(text) {
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') quoted = !quoted
    else if (quoted) continue
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ';' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
    if (depth < 0) return null
  }
  // Every statement ends with `;`, so nothing may trail the last one
  return depth === 0 && !quoted && start === text.length ? parts : null
}

// Sticky-regex scan that must consume the whole string; returns matches or null
function scanAll(re, text) {
  const out = []
  let pos = 0
  while (pos < text.length) {
    re.lastIndex = pos
    const m = re.exec(text)
    if (!m) return null
    out.push(m)
    pos = re.lastIndex
  }
  return out
}

function parseSettings(head) {
  const settings = {}
  const found = scanAll(/\[(out|timeout|bbox):([^\]]*)\]/y, head)
  if (!found) return null
  for (const m of found) {
    if (settings[m[1]] !== undefined) return null
    settings[m[1]] = m[2]
  }
  if (settings.out !== undefined && settings.out !== 'json') return null
  if (settings.timeout !== undefined && !/^\d{1,4}$/.test(settings.timeout)) return null
  if (settings.bbox === undefined) return settings
  const nums = settings.bbox.split(',').map(Number)
  const [s, w, n, e] = nums
  if (nums.length !== 4 || !nums.every(Number.isFinite)) return null
  if (!(s < n && w < e && s >= -90 && n <= 90 && w >= -180 && e <= 180)) return null
  if (n - s > MAX_LAT_SPAN || e - w > MAX_LON_SPAN) return null
  return { ...settings, bbox: { s, w, n, e } }
}

// `nw["shop"~"^(a|b)$"]["name"]` → { types, keys: {shop:[a,b]}, name, wikidata }
function parseFilterStatement(text) {
  const m = /^(nwr|nw|node|way|relation)((?:\[[^\]]*\])+)$/.exec(text)
  if (!m) return null
  const stmt = { types: TYPE_CODES[m[1]], keys: {}, name: false, wikidata: false }
  const filters = scanAll(/\["([a-z_:]+)"(?:(=|~)"([^"]*)")?\]/y, m[2])
  if (!filters) return null
  for (const [, key, op, value] of filters) {
    if (!op) {
      if (key !== 'name' && key !== 'wikidata') return null
      stmt[key] = true
      continue
    }
    if (!KEYS.has(key) || stmt.keys[key]) return null
    const values = op === '=' ? [value] : (/^\^\(([^()]*)\)\$$/.exec(value)?.[1].split('|') ?? [])
    if (values.length === 0 || !values.every(v => VALUE.test(v))) return null
    // Every requested value must be one the build extracts, or the answer
    // would silently miss it (amenity=bank is not in the table)
    if (!values.every(v => SUPPORTED.get(key)?.has(v))) return null
    stmt.keys[key] = [...new Set(values)]
  }
  // Without a key filter it would mean "everything named here", which the POI
  // table (a subset of OSM) can't answer faithfully
  return Object.keys(stmt.keys).length > 0 ? stmt : null
}

function parseIdStatement(text) {
  const m = /^(node|way|relation)\((\d{1,15})\)$/.exec(text)
  return m ? { type: OSM_TYPE_CODE[m[1]], id: Number(m[2]) } : null
}

function parseOut(text) {
  if (CENTER_OUTS.has(text)) return { limit: null }
  const m = /^out tags bb (\d{1,4})$/.exec(text)
  return m && m[1] > 0 && m[1] <= MAX_LIMIT ? { limit: Number(m[1]) } : null
}

/**
 * Overpass QL → plan, or null if the query isn't one we answer.
 * Plan: { bbox: {s,w,n,e}|null, kind: 'area'|'id', groups: [{ statements, limit }] }
 * Each group is one output statement: a union (deduplicated) or a single statement.
 */
export function parseQuery(ql) {
  if (typeof ql !== 'string' || ql.length > 10000) return null
  const text = normalise(ql)
  const headEnd = text.startsWith('[') ? text.indexOf(';') : 0
  if (headEnd < 0) return null
  const settings = parseSettings(text.slice(0, headEnd))
  if (!settings) return null

  // Top-level units: a parenthesised union or a single statement, each ending in `;`
  const units = splitTop(text.slice(headEnd).replace(/^;/, ''))
  if (!units) return null
  const groups = []
  let pending = null
  for (const unit of units) {
    const out = unit.startsWith('out') ? parseOut(unit) : undefined
    if (out === null) return null
    if (out) {
      if (!pending) return null
      if (out.limit && pending.length > 1) return null
      groups.push({ statements: pending, limit: out.limit })
      pending = null
      continue
    }
    if (pending) return null // a statement nobody outputs
    const texts = unit.startsWith('(') && unit.endsWith(')') ? splitTop(unit.slice(1, -1)) : [unit]
    if (!texts) return null
    pending = texts.map(t => parseIdStatement(t) || parseFilterStatement(t))
    if (pending.length === 0 || pending.some(s => !s)) return null
  }
  if (pending || groups.length === 0) return null

  const all = groups.flatMap(g => g.statements)
  const idCount = all.filter(s => s.id !== undefined).length
  if (idCount > 0 && idCount !== all.length) return null
  // Only a single typed id. A bare number is a union of node(N) and way(N):
  // if the DB holds just one of them (a UK way) while the real place is the
  // other (a Paris node), we'd answer confidently and wrongly.
  if (idCount > 1) return null
  if (idCount === 0 && !settings.bbox) return null
  return { bbox: idCount ? null : settings.bbox, kind: idCount ? 'id' : 'area', groups }
}


function statementSql(stmt, params) {
  if (stmt.id !== undefined) {
    params.push(stmt.type, stmt.id)
    return '(osm_type = ? AND osm_id = ?)'
  }
  const parts = [`osm_type IN (${stmt.types.map(() => '?').join(',')})`]
  params.push(...stmt.types)
  // Keys are from the KEYS whitelist, so the column name is safe; values are
  // bound. Overpass matches tag values exactly: case and trailing spaces count.
  const keyed = Object.entries(stmt.keys).map(([key, values]) => {
    params.push(...values)
    // NO PAD binary collation: utf8mb4_bin is PAD SPACE, so 'cafe ' would match 'cafe'
    return `k_${key} COLLATE utf8mb4_0900_bin IN (${values.map(() => '?').join(',')})`
  })
  parts.push(...keyed)
  // has_name also counts name:en; Overpass ["name"] needs the name tag itself
  if (stmt.name) parts.push('has_name_tag = 1')
  if (stmt.wikidata) parts.push('has_wikidata = 1')
  return `(${parts.join(' AND ')})`
}

/**
 * The whole plan as ONE statement (one round trip on the single pooled
 * connection, one MAX_EXECUTION_TIME for all of it): a parenthesised SELECT per
 * output group, joined by UNION ALL, tagged with its group index. Exported for tests.
 */
export function buildSql(plan, table = 'pois') {
  if (!/^pois(?:_staging|_prev)?$/.test(table)) throw new Error(`bad poi table ${table}`)
  const params = []
  const selects = plan.groups.map((group, g) => {
    const where = []
    if (plan.bbox) {
      const { s, w, n, e } = plan.bbox
      // Overpass (bbox) returns ways and relations that INTERSECT the box. Rows
      // are celled by centre, so scan cells padded by the largest half-extent the
      // build allows, then keep rows whose bounds touch the box (nodes: min=max).
      // Elements wider than the pad (Bristol Channel) all live in LARGE_CELL.
      const ranges = [[LARGE_CELL, LARGE_CELL], ...cellRanges(s - CELL_PAD_DEG, w - CELL_PAD_DEG, n + CELL_PAD_DEG, e + CELL_PAD_DEG)]
      where.push(`(${ranges.map(() => 'cell BETWEEN ? AND ?').join(' OR ')})`)
      params.push(...ranges.flat())
      where.push('max_lat >= ? AND min_lat <= ? AND max_lon >= ? AND min_lon <= ?')
      params.push(s, n, w, e)
    }
    where.push(`(${group.statements.map(st => statementSql(st, params)).join(' OR ')})`)
    // One row past the scan bound tells queryPois the answer is too big.
    // The hint is only allowed in the first SELECT and covers the whole statement.
    params.push(group.limit || SCAN_ROWS + 1)
    return `(SELECT ${g === 0 ? `${HINT} ` : ''}${g} AS g, osm_type, osm_id, el FROM ${table} ` +
      `WHERE ${where.join(' AND ')} ORDER BY osm_type, osm_id LIMIT ?)`
  })
  return { sql: `${selects.join(' UNION ALL ')} ORDER BY g, osm_type, osm_id`, params }
}

// An id answer must be the element asked for, checked in the stored JSON too
function isRequested(stmt, row) {
  if (row.osm_type !== stmt.type || Number(row.osm_id) !== stmt.id) return false
  try {
    const el = JSON.parse(row.el)
    return el.type === OSM_TYPE_NAME[stmt.type] && el.id === stmt.id
  } catch {
    return false
  }
}

const OSM_COPYRIGHT = 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.'

function envelope(els, osmTimestamp) {
  return '{"version":0.6,"generator":"roam-poi-db","osm3s":{"timestamp_osm_base":' +
    `${JSON.stringify(osmTimestamp || '')},"copyright":${JSON.stringify(OSM_COPYRIGHT)}},` +
    `"elements":[${els.join(',')}]}`
}

/**
 * Run a plan. Returns { body, n, ids } where body is the Overpass JSON envelope
 * string, or { truncated: true } when the answer is over MAX_BODY_BYTES (or a
 * group over SCAN_ROWS). Throws on a DB error or timeout.
 */
export async function queryPois(plan, { osmTimestamp = coverage.osmTimestamp } = {}) {
  const { sql, params } = buildSql(plan)
  const [rows] = await getPool().query({ sql, timeout: 2500 }, params)
  const els = []
  const ids = []
  const perGroup = new Array(plan.groups.length).fill(0)
  let bytes = Buffer.byteLength(envelope([], osmTimestamp)) // the whole envelope counts
  for (const r of rows) {
    const group = plan.groups[r.g]
    if (!group.limit && ++perGroup[r.g] > SCAN_ROWS) return { truncated: true }
    if (plan.kind === 'id' && !isRequested(group.statements[0], r)) continue
    bytes += Buffer.byteLength(r.el) + 1
    if (bytes > MAX_BODY_BYTES) return { truncated: true }
    els.push(r.el)
    ids.push(`${OSM_TYPE_NAME[r.osm_type]}/${r.osm_id}`)
  }
  return { body: envelope(els, osmTimestamp), n: els.length, ids }
}

// ─── Serving wrapper: coverage, breaker, dedupe, LRU (all per instance) ───

// Table generation: its own KV key, bumped by atomic INCR in the loader and
// rollback after every table swap, so every instance drops its cached answers.
// Kept out of roam:flags so writing one can never clobber the other.
export const POI_GEN_KEY = 'roam:poiGen'
const GEN_TTL_MS = 30 * 1000
const genCache = { value: 0, at: 0, loading: null }

/** The cached generation if fresh, else null. Synchronous. */
export function peekPoiGen() {
  return Date.now() - genCache.at < GEN_TTL_MS ? genCache.value : null
}

/**
 * The generation, cached ~30 s. Never throws: a miss, a KV failure or a junk
 * value keeps the last known one (0 before any bump).
 */
export async function getPoiGen() {
  const fresh = peekPoiGen()
  if (fresh !== null) return fresh
  genCache.loading ||= (async () => {
    try {
      const n = Number(await cacheGet(POI_GEN_KEY))
      // cacheGet is null on a miss and on failure alike; both keep the last known
      if (Number.isSafeInteger(n) && n > 0) genCache.value = n
    } catch {
      // keep the last known
    }
    genCache.at = Date.now()
  })().finally(() => { genCache.loading = null })
  await genCache.loading
  return genCache.value
}

const COVERAGE_TTL_MS = 5 * 60 * 1000
const COVERAGE_RETRY_MS = 30 * 1000
const coverage = { cells: null, buildId: null, osmTimestamp: null, gen: null, nextAt: 0, retryAt: 0, loading: null, tried: false }

function isoSeconds(v) {
  if (v instanceof Date) return v.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return v == null ? null : String(v)
}

// Holds the instance's single SQL slot (see `active`) for its duration
async function loadCoverage(gen) {
  active++
  try {
    const [rows] = await getPool().query({
      sql: `SELECT ${HINT} build_id, schema_version, osm_timestamp, coverage FROM poi_builds WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1`,
      timeout: 2500
    })
    const row = rows[0]
    const cells = typeof row?.coverage === 'string' ? JSON.parse(row.coverage) : row?.coverage
    if (!row || row.schema_version !== POI_SCHEMA_VERSION || !Array.isArray(cells)) {
      Object.assign(coverage, { cells: null, buildId: null, osmTimestamp: null })
    } else {
      Object.assign(coverage, { cells: new Set(cells), buildId: row.build_id, osmTimestamp: isoSeconds(row.osm_timestamp) })
    }
    // Only a successful read confirms the generation; after a failed one a
    // newer gen stays unconfirmed and getPois declines it (fails closed)
    coverage.gen = gen
    coverage.nextAt = Date.now() + COVERAGE_TTL_MS
    coverage.retryAt = 0
  } catch (err) {
    // Last known coverage stays (for the gen it was read under); before the
    // tables exist this is the normal path
    console.warn('[poi] coverage refresh failed:', err.message)
    coverage.retryAt = Date.now() + COVERAGE_RETRY_MS
  } finally {
    active--
  }
  coverage.tried = true
}

/**
 * The active build ({ cells, buildId, osmTimestamp }). Only the very first
 * load is awaited (the caller bounds it with a deadline); after that, a stale
 * copy is served while a refresh runs in the background. Never throws.
 */
async function getCoverage(gen = 0, deadlineAt = Infinity) {
  // A newer generation (roam:poiGen, bumped by the loader and rollback after a
  // table swap) forces a reload now rather than in up to 5 minutes. It only
  // moves forward: an older gen (a stale flag read) never reloads, and
  // getPois then declines it.
  const newer = coverage.gen === null || gen > coverage.gen
  const now = Date.now()
  const due = (now >= coverage.nextAt || newer) && now >= coverage.retryAt
  // Shares the one SQL slot with data queries, and respects the caller's deadline
  if (due && !coverage.loading && active === 0 && deadlineAt - now >= MIN_REMAINING_MS) {
    coverage.loading = loadCoverage(newer ? gen : coverage.gen).finally(() => { coverage.loading = null })
  }
  if (!coverage.tried && coverage.loading) await coverage.loading
  return coverage
}

/** Is the plan answerable from the active build? Id lookups only need a build.
 *  Uses the unpadded bbox cells, so LARGE_CELL never takes part. Without
 *  `cov`: the last-known coverage, without loading it (for logs). */
export function isCovered(plan, cov = coverage) {
  if (!cov.cells) return false
  if (!plan.bbox) return true
  const { s, w, n, e } = plan.bbox
  for (const [lo, hi] of cellRanges(s, w, n, e)) {
    for (let c = lo; c <= hi; c++) if (!cov.cells.has(c)) return false
  }
  return true
}

const BREAKER_FAILURES = 3
const BREAKER_OPEN_MS = 60 * 1000
const breaker = { fails: 0, openUntil: 0, probing: false }

// Closed, or open long enough that one half-open probe may go through
function breakerAllows(now = Date.now()) {
  if (breaker.fails < BREAKER_FAILURES) return true
  if (now < breaker.openUntil || breaker.probing) return false
  breaker.probing = true
  return true
}

function breakerResult(ok) {
  breaker.probing = false
  if (ok) {
    breaker.fails = 0
    return
  }
  breaker.fails++
  if (breaker.fails >= BREAKER_FAILURES) breaker.openUntil = Date.now() + BREAKER_OPEN_MS
}

export const breakerState = () => (breaker.fails < BREAKER_FAILURES ? 'closed' : Date.now() < breaker.openUntil ? 'open' : 'half-open')

// ponytail: per-instance only; add a CDN-cacheable GET endpoint if DB CPU becomes the limit (plan §4)
const LRU_MAX = 50
const LRU_TTL_MS = 10 * 60 * 1000
const lru = new Map()
const inflight = new Map()
// Admission control: the pool has ONE connection, so a second query would only
// queue behind the first and outlive the caller's deadline
let active = 0
// LRU value meaning "too big for the DB path": skip the scan for 10 minutes
const OVER_CAP = Symbol('over cap')

function remember(cacheKey, value) {
  lru.set(cacheKey, { at: Date.now(), value })
  if (lru.size > LRU_MAX) lru.delete(lru.keys().next().value)
}

/**
 * Serve a plan from the DB when it can be: returns { body, n, ids, buildId, ms, cached }
 * or null (not covered, too big, busy, too close to the deadline, breaker open,
 * DB error). Never throws. `key` identifies the query (the snapped query string).
 * `gen` is the roam:poiGen generation: results are only served and cached for coverage
 * loaded under the same generation. `deadlineAt` is when the caller stops
 * waiting. `useLru: false` (shadow mode) neither reads nor fills the LRU with
 * results, so db_ms is a real query time.
 */
export async function getPois(plan, key, { useLru = true, gen = 0, deadlineAt = Infinity } = {}) {
  const cov = await getCoverage(gen, deadlineAt)
  if (cov.gen !== gen || !isCovered(plan, cov)) return null
  const { buildId } = cov
  const cacheKey = `${gen}|${buildId}|${key}`
  const hit = lru.get(cacheKey)
  const fresh = hit && Date.now() - hit.at < LRU_TTL_MS
  if (fresh && hit.value === OVER_CAP) return null // shadow honours this too
  if (fresh && useLru) {
    lru.delete(cacheKey)
    lru.set(cacheKey, hit)
    return { ...hit.value, ms: 0, cached: true }
  }
  if (inflight.has(cacheKey)) return inflight.get(cacheKey)
  if (active > 0 || deadlineAt - Date.now() < MIN_REMAINING_MS) return null
  if (!breakerAllows()) return null

  active++
  const run = (async () => {
    const started = Date.now()
    try {
      const result = await queryPois(plan, { osmTimestamp: cov.osmTimestamp })
      // Cache only under a build still confirmed for this generation
      const confirmed = coverage.gen === gen && coverage.buildId === buildId
      // Too slow is a failure: the caller already gave up and served the old path
      breakerResult(Date.now() - started <= POI_DEADLINE_MS)
      if (result.truncated) {
        console.warn('[poi] over the size cap, using the legacy path')
        if (confirmed) remember(cacheKey, OVER_CAP)
        return null
      }
      const value = { ...result, buildId }
      if (confirmed && useLru && result.n > 0 && Buffer.byteLength(result.body) <= LRU_MAX_BYTES) remember(cacheKey, value)
      return { ...value, ms: Date.now() - started, cached: false }
    } catch (err) {
      breakerResult(false)
      console.warn('[poi] query failed:', err.message)
      return null
    } finally {
      active--
      inflight.delete(cacheKey)
    }
  })()
  inflight.set(cacheKey, run)
  return run
}

/** Test hook: forget all per-instance state. */
export function _resetPoiState() {
  Object.assign(coverage, { cells: null, buildId: null, osmTimestamp: null, gen: null, nextAt: 0, retryAt: 0, loading: null, tried: false })
  active = 0
  Object.assign(genCache, { value: 0, at: 0, loading: null })
  Object.assign(breaker, { fails: 0, openUntil: 0, probing: false })
  lru.clear()
  inflight.clear()
}
