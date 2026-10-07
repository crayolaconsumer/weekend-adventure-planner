/**
 * Answers a small, known subset of Overpass QL from our own `pois` table
 * (see /database/phase11-pois.sql and the POI build job).
 *
 * parseQuery(ql) turns a query the app emits into a plan, or null for anything
 * it doesn't recognise (around:, poly:, area, recursion, unknown keys...). Null
 * means "not ours": the caller takes the legacy KV/Overpass path unchanged.
 *
 * queryPois(plan) runs it and returns the same Overpass JSON envelope the proxy
 * serves today, built by concatenating the stored element strings. A Discover
 * answer over CAP rows is cut to the CAP rows the phone's deck would deal from
 * (shared/poiRank.mjs), read in two phases so el is only fetched for those.
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
import { getPool, dedicatedConnection, runQuery } from './db.js'
import { cacheGet } from './kvCache.js'
import { cellRanges, CELL_PAD_DEG, LARGE_CELL, OSM_TYPE_CODE, OSM_TYPE_NAME, SCHEMA_VERSION } from '../../shared/poiCell.mjs'
// The build's own osmium filter: a key=value outside it isn't in the table
import { POI_KEYS, filterPairs } from '../../scripts/poi/filter.mjs'
import { rankCap, FEATURES_VERSION, ELIGIBLE, CAP } from '../../shared/poiRank.mjs'
import { SNAP_GRID_DEGREES } from './bboxSnap.js'

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
// A dense answer the relevance cap may serve gets longer (nearby.js waits past
// POI_DEADLINE_MS only when KV has no copy): measured on prod (London 15 km, warm) it's
// ~0.6 s, 1-1.7 s with a cold connection or buffer pool, and the old path it would fall back
// to is public Overpass, which times out on those tiles. The capped transaction stays bounded
// by CAP_TXN_MS (2 s) plus one statement; a served one may now use all of it (it used to end
// near 1 s), so the loader's RENAME (lock_wait_timeout 5 s) can wait up to ~3 s behind it.
export const POI_CAP_DEADLINE_MS = 2500
// Don't submit SQL with less than this left before the caller's deadline
const MIN_REMAINING_MS = 200
// Server-side bound: MySQL kills the SELECT, so the connection is freed too
// (the mysql2 timeout alone only rejects the promise)
const HINT = '/*+ MAX_EXECUTION_TIME(800) */'
// Relevance cap (shared/poiRank.mjs, rubric /tmp/roam-overnight/ranking/RUBRIC.md):
// a Discover answer over CAP rows is served as the CAP rows the phone's deck
// would deal from. Phase 1 reads compact candidates (no el) through ix_rank;
// more than RANK_SCAN_ROWS of them takes the old path. Phase 2 reads el for
// the chosen ids, ID_BATCH per statement.
// The relevance cap's size lives with the ranker (shared/poiRank.mjs), so the eval uses the same
export { CAP }
// Below this share of deck-eligible candidates the features are not trusted (see cappedAnswer)
const CAP_MIN_ELIGIBLE = 0.5
export const RANK_SCAN_ROWS = 60_000
const ID_BATCH = 1000
// LRU: a byte budget, not an entry count. A capped dense answer is ~1.1 MB
// (London 30 km) and must be cached; a town page is ~50 KB. UTF-8 bytes of
// the body; V8 may hold up to twice that for non-Latin-1 text.
export const LRU_BUDGET_BYTES = 16_000_000
export const LRU_ENTRY_MAX_BYTES = 2_000_000
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
  // A bare number is a union of node(N) and way(N). Every DB row is named with a
  // place tag (osmPick's best score) and the node wins its ties, so ask for the
  // node only: a DB node N is the answer; none (only a way here, perhaps losing
  // to a Paris node) falls through to Overpass
  if (idCount === 2 && groups.length === 1) {
    const [a, b] = all
    const node = [a, b].find(s => s.type === OSM_TYPE_CODE.node)
    const way = [a, b].find(s => s.type === OSM_TYPE_CODE.way)
    if (!node || !way || node.id !== way.id) return null
    groups[0].statements = [node]
  } else if (idCount > 1) return null
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

const checkTable = (table) => {
  if (!/^pois(?:_staging|_prev)?$/.test(table)) throw new Error(`bad poi table ${table}`)
}

// One output group's WHERE, binding its values into params
function groupWhere(plan, group, params) {
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
  return where.join(' AND ')
}

/**
 * The whole plan as ONE statement (one round trip on the single pooled
 * connection, one MAX_EXECUTION_TIME for all of it): a parenthesised SELECT per
 * output group, joined by UNION ALL, tagged with its group index. Exported for tests.
 */
export function buildSql(plan, table = 'pois', scanLimit = SCAN_ROWS + 1) {
  checkTable(table)
  const params = []
  const selects = plan.groups.map((group, g) => {
    const where = groupWhere(plan, group, params)
    // One row past the scan bound tells queryPois the answer is too big.
    // The hint is only allowed in the first SELECT and covers the whole statement.
    params.push(group.limit || scanLimit)
    // Area reads go through the cell range. Left alone, MySQL walks uq_osm in id
    // order for the LIMIT (24 s for York) or full-scans dense London (20 s).
    return `(SELECT ${g === 0 ? `${HINT} ` : ''}${g} AS g, osm_type, osm_id, el FROM ${table}${plan.bbox ? ' FORCE INDEX (PRIMARY)' : ''} ` +
      `WHERE ${where} ORDER BY osm_type, osm_id LIMIT ?)`
  })
  return { sql: `${selects.join(' UNION ALL ')} ORDER BY g, osm_type, osm_id`, params }
}

// Only boxes of a single Discover query up to 30 km (plus slack) are capped. Past 42 km the
// app (src/utils/apiClient.js sampleLargeRadius) sends 35 km tiles, four of them centred
// half the radius AWAY from the phone, and merges them: the server can't tell a tile from a
// phone at its centre, and the ranker's position assumptions (the phone within half a snap
// cell of the box centre) don't hold. Those, and any single query of 34.5 km or more, are
// served exactly as before. Radius from the box's height, as radiusToBbox builds it.
export const MAX_CAP_RADIUS_KM = 34.5
const LAT_KM_PER_DEG = 111.32

/** A Discover answer (one unlimited output over a bbox of radius < MAX_CAP_RADIUS_KM): the only kind the cap ranks. */
export const isRankable = plan => plan.kind === 'area' && plan.groups.length === 1 && !plan.groups[0].limit &&
  ((plan.bbox.n - plan.bbox.s) / 2) * LAT_KM_PER_DEG < MAX_CAP_RADIUS_KM

/**
 * Cap phase 1: the same WHERE as buildSql, reading only ix_rank (a covering
 * index: bounds and features, osm_type/osm_id from the PK suffix), so no el
 * is read. Unordered: queryPois sorts the candidates itself.
 */
export function buildCandidateSql(plan, table = 'pois') {
  checkTable(table)
  const params = []
  const where = groupWhere(plan, plan.groups[0], params)
  params.push(RANK_SCAN_ROWS + 1)
  return {
    sql: `SELECT ${HINT} osm_type, osm_id, min_lat, max_lat, min_lon, max_lon, q, cat, flags FROM ${table} FORCE INDEX (ix_rank) WHERE ${where} LIMIT ?`,
    params
  }
}

/**
 * The cap's probe: is this answer over CAP? The same WHERE, index-only through
 * ix_rank (no el read), stopping at CAP + 1 rows. Outside any transaction.
 */
export function buildProbeSql(plan, table = 'pois') {
  checkTable(table)
  const params = []
  const where = groupWhere(plan, plan.groups[0], params)
  params.push(CAP + 1)
  return { sql: `SELECT ${HINT} osm_type FROM ${table} FORCE INDEX (ix_rank) WHERE ${where} LIMIT ?`, params }
}

/** Cap phase 2: el for chosen ids of one osm_type, through uq_osm. */
export function buildElSql(type, ids, table = 'pois') {
  checkTable(table)
  return {
    sql: `SELECT ${HINT} osm_type, osm_id, el FROM ${table} FORCE INDEX (uq_osm) WHERE osm_type = ? AND osm_id IN (${ids.map(() => '?').join(',')})`,
    params: [type, ...ids]
  }
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

// Envelope from rows in output order. { body, n, ids }, or { truncated: true }
// when an unlimited group passes SCAN_ROWS or the body passes MAX_BODY_BYTES.
function toAnswer(plan, rows, osmTimestamp) {
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

const byOsm = (a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id

/**
 * Run a plan. Returns { body, n, ids } where body is the Overpass JSON envelope
 * string, or { truncated: true } when the answer is over MAX_BODY_BYTES (or a
 * group over SCAN_ROWS, or a Discover answer over RANK_SCAN_ROWS). Throws on a
 * DB error, a timeout, or the deadline passing between statements; an error
 * inside the capped transaction carries `cap: true` (getPois gives it to the
 * cap breaker, never to the shared one).
 *
 * `features`: cap this plan if it is dense. The caller sets it only when the
 * active build carries this code's features (FEATURES_VERSION) and poiCapPct
 * covers the request. Then an index-only probe through ix_rank (no el) decides:
 * at or under CAP, today's statement serves as always; over it, the capped
 * transaction runs. Its results carry capPath: true and phase timings (ms):
 * { probe, candidates, rank, el }.
 */
export async function queryPois(plan, { osmTimestamp = coverage.osmTimestamp, deadlineAt = Infinity, features = false, buildId = coverage.buildId, conn = null } = {}) {
  // `conn`: a dedicated connection (shadow); otherwise the instance's pool
  const send = conn ? (o, p) => conn.query(o, p) : (o, p) => runQuery(o.sql, p, o.timeout)
  // Time spent in today's statement: all the shared breaker may judge (sharedMs). Everything
  // else (probe, capped transaction) is the cap's, and every error it throws carries cap: true
  let sharedMs = null // null: today's statement never ran (a capped answer)
  const today = async () => {
    const started = Date.now()
    const { sql, params } = buildSql(plan)
    const [rows] = await send({ sql, timeout: 2500 }, params)
    sharedMs = (sharedMs ?? 0) + Date.now() - started
    return toAnswer(plan, rows, osmTimestamp)
  }
  if (!features || !isRankable(plan)) return { ...(await today()), sharedMs }
  const asCap = async fn => {
    try {
      return await fn()
    } catch (err) {
      err.cap = true
      throw err
    }
  }
  let t = performance.now()
  const probe = buildProbeSql(plan)
  const [hits] = await asCap(() => send({ sql: probe.sql, timeout: 2500 }, probe.params))
  const timings = { probe: since(t) }
  if (hits.length <= CAP) return { ...(await today()), timings, sharedMs }
  const capped = await asCap(() => queryCapped(plan, osmTimestamp, Math.min(deadlineAt, Date.now() + CAP_TXN_MS), buildId, conn))
  Object.assign(timings, capped.timings)
  if (!capped.fallback) return { ...capped, timings, sharedMs, capPath: true }
  // The candidates can't be ranked (features zero or stale, or a swap shrank the answer):
  // today's path, uncapped. Never a thin capped deck, and never cached (getPois)
  console.warn(JSON.stringify({ evt: 'poi_cap_fallback', reason: capped.fallback, scanned: capped.scanned, eligible: capped.eligible, table: capped.table }))
  t = performance.now()
  const answer = await today()
  return { ...answer, timings: { ...timings, today: since(t) }, sharedMs, capPath: true, capFallback: capped.fallback }
}

const since = t => Math.round(performance.now() - t)

// The capped read's own time bound, whatever the caller's deadline (shadow has
// none). See queryCapped for why it must stay well under the loader's 5 s.
const CAP_TXN_MS = 2000
// Server-side bounds for the capped transaction's session (see queryCapped). wait_timeout:
// idle seconds before MySQL closes the session (ending the transaction and its MDL);
// lock_wait_timeout: how long our own reads wait for a metadata lock (a pending RENAME);
// innodb_lock_wait_timeout: row locks (none taken by these reads, bounded anyway);
// max_execution_time: every SELECT, as the per-statement hint does.
const TXN_IDLE_S = 5
const TXN_SESSION = `SET SESSION wait_timeout = ${TXN_IDLE_S}, lock_wait_timeout = 2, innodb_lock_wait_timeout = 2, max_execution_time = 800`
const RESTORE_SESSION = 'SET SESSION wait_timeout = @@GLOBAL.wait_timeout, lock_wait_timeout = @@GLOBAL.lock_wait_timeout, ' +
  'innodb_lock_wait_timeout = @@GLOBAL.innodb_lock_wait_timeout, max_execution_time = @@GLOBAL.max_execution_time'

/**
 * The two phases, in ONE read-only transaction on one connection. Reading
 * `pois` takes a shared metadata lock that is held until the transaction ends,
 * so the loader's swap (RENAME TABLE pois TO pois_prev, pois_staging TO pois)
 * waits for us and both phases read the same build.
 *
 * While that RENAME waits, every newer reader of `pois` queues behind it (MDL
 * is first come, first served), so this transaction must stay short: it is
 * bounded by CAP_TXN_MS plus one statement's MAX_EXECUTION_TIME (800 ms), about
 * 3 s, against the loader's lock_wait_timeout of 5 s (poi-load.js withPoiLock).
 * If the RENAME does time out, the loader answers 503 and retries; nothing is
 * half-swapped. On ANY error (including a failed ROLLBACK or restore) the
 * connection is destroyed, never reused: a ROLLBACK would queue behind a
 * statement still running after a client-side timeout. Closing the session
 * ends the transaction as soon as the server stops that statement
 * (MAX_EXECUTION_TIME at the latest), freeing the lock.
 *
 * The server bounds it too, whatever happens to this function (suspended by
 * Fluid, frozen, killed): TXN_SESSION is set before START TRANSACTION, so a
 * session left idle inside the transaction is closed by MySQL after
 * wait_timeout (TXN_IDLE_S) seconds, which ends the transaction and releases
 * the lock. The pool's connection is shared, so those settings are put back
 * (to the server's globals) after the ROLLBACK, before it is released.
 */
async function queryCapped(plan, osmTimestamp, deadlineAt, buildId, dedicated = null) {
  // A dedicated (shadow) connection is the caller's, closed after this run: no settings to restore
  const conn = dedicated ?? await getPool().getConnection()
  let clean = false
  const run = async ({ sql, params }) => {
    // Like the first statement: none sent that would outlive the caller's wait
    if (deadlineAt - Date.now() < MIN_REMAINING_MS) throw new Error('too close to the deadline')
    return (await conn.query({ sql, timeout: 2500 }, params))[0]
  }
  try {
    await conn.query({ sql: TXN_SESSION, timeout: 1000 })
    await conn.query({ sql: 'START TRANSACTION READ ONLY', timeout: 2500 })
    const result = await cappedAnswer(plan, osmTimestamp, run, buildId)
    await conn.query({ sql: 'ROLLBACK', timeout: 1000 }) // read-only: ending it is all there is to do
    if (!dedicated) await conn.query({ sql: RESTORE_SESSION, timeout: 1000 })
    clean = true
    return result
  } finally {
    if (!dedicated) {
      if (clean) conn.release()
      else conn.destroy()
    }
  }
}

// The build the live `pois` holds: the loader stamps its id into the table COMMENT and
// RENAME carries it (poi-load.js begin). Read inside the transaction, after phase 1 has
// taken the metadata lock, so it names the very table the candidates came from.
export const TABLE_BUILD_SQL = "SELECT table_comment AS owner FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pois'"

async function cappedAnswer(plan, osmTimestamp, run, buildId) {
  let t = performance.now()
  const candidates = await run(buildCandidateSql(plan))
  const timings = { candidates: since(t) }
  // Only the build whose features_version we read (coverage, cached up to 5 min) may be
  // ranked: after a swap or rollback in between, the table may be another build, with no
  // features at all. On mismatch or doubt, today's (uncapped) path
  const [table] = await run({ sql: TABLE_BUILD_SQL, params: [] })
  if (!buildId || table?.owner !== buildId) return { fallback: 'build_mismatch', scanned: candidates.length, table: table?.owner ?? null, timings }
  const scanned = candidates.length
  if (scanned > RANK_SCAN_ROWS) {
    // Too dense even to rank: today's path (Overpass/KV). Logged, so we see how often
    console.warn(JSON.stringify({ evt: 'poi_cap_fallback', reason: 'too_dense', scanned, limit: RANK_SCAN_ROWS }))
    return { truncated: true, timings }
  }
  // A swap between the probe and this transaction left a smaller build: today's answer
  if (scanned <= CAP) return { fallback: 'not_dense', scanned, timings }
  // Features all zero (an older loader's rows) or from another ranker version would rank on
  // nothing and deal a thin deck: Discover rows measure 97-99% deck-eligible
  let eligible = 0
  for (const c of candidates) if (c.flags & ELIGIBLE) eligible++
  if (eligible < CAP_MIN_ELIGIBLE * scanned) return { fallback: 'features', scanned, eligible, timings }

  // Row order is the tie-break, so rank in the order the DB serves (osm_type, osm_id)
  candidates.sort(byOsm)
  t = performance.now()
  const { s, w, n, e } = plan.bbox
  // The bbox is snapped (bboxSnap.js), so every phone within half a grid cell of its
  // centre shares this body: the ranker's stratum floor holds for all of them
  const chosen = rankCap(candidates, { lat: (s + n) / 2, lng: (w + e) / 2 }, CAP, SNAP_GRID_DEGREES / 2)
  timings.rank = since(t)
  t = performance.now()
  const rows = []
  for (const type of [1, 2, 3]) {
    const ids = chosen.filter(c => c.osm_type === type).map(c => c.osm_id)
    for (let i = 0; i < ids.length; i += ID_BATCH) rows.push(...await run(buildElSql(type, ids.slice(i, i + ID_BATCH))))
  }
  timings.el = since(t)
  // Same snapshot, so every chosen id is there; anything else is a bug, not an answer
  if (rows.length !== chosen.length) throw new Error(`cap phase 2 read ${rows.length} of ${chosen.length} rows`)
  const answer = toAnswer(plan, rows.map(r => ({ ...r, g: 0 })).sort(byOsm), osmTimestamp)
  return answer.truncated ? { ...answer, timings } : { ...answer, scanned, rankMs: timings.rank, timings }
}

// ─── Serving wrapper: coverage, breaker, dedupe, LRU (all per instance) ───

// Table generation: its own KV key, bumped by atomic INCR in the loader and
// rollback after every table swap, so every instance drops its cached answers.
// Kept out of roam:flags so writing one can never clobber the other.
export const POI_GEN_KEY = 'roam:poiGen'
const GEN_TTL_MS = 30 * 1000
const GEN_KV_TIMEOUT_MS = 2000 // the Upstash client has no timeout of its own
const genCache = { value: 0, at: 0, loading: null, loadingAt: 0 }

/**
 * The last known generation (0 before any bump), null only before this
 * instance's first read. Synchronous. Past its ~30 s TTL it is still returned
 * and starts the background refresh, so a hung or failing KV never turns the
 * Discover POI path off (the generation only busts caches; serving an old one
 * for a while is safe, and it only ever goes up).
 */
export function peekPoiGen() {
  if (!genCache.at) return null
  if (Date.now() - genCache.at >= GEN_TTL_MS) getPoiGen().catch(() => {})
  return genCache.value
}

/**
 * The generation, cached ~30 s. Never throws: a miss, a KV failure, a junk
 * value or a read slower than 2 s keeps the last known one. One read at a time
 * per instance; one outliving its timeout (frozen with the function) is replaced.
 */
export async function getPoiGen() {
  const now = Date.now()
  if (genCache.at && now - genCache.at < GEN_TTL_MS) return genCache.value
  if (!genCache.loading || now - genCache.loadingAt > GEN_KV_TIMEOUT_MS) {
    const read = Promise.resolve().then(() => cacheGet(POI_GEN_KEY)).then(v => {
      const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN
      // cacheGet is null on a miss and on failure alike; both keep the last known.
      // Applied even if it lands after the timeout: the generation only goes up
      if (Number.isSafeInteger(n) && n > genCache.value) genCache.value = n
    }, () => {})
    let timer
    const loading = Promise.race([read, new Promise(resolve => { timer = setTimeout(resolve, GEN_KV_TIMEOUT_MS) })])
      .then(() => {
        clearTimeout(timer)
        genCache.at = Math.max(genCache.at, now) // restart the window from the read's start
      })
      .finally(() => { if (genCache.loading === loading) genCache.loading = null })
    Object.assign(genCache, { loading, loadingAt: now })
  }
  await genCache.loading
  return genCache.value
}

const COVERAGE_TTL_MS = 5 * 60 * 1000
const COVERAGE_RETRY_MS = 30 * 1000
const coverage = { cells: null, buildId: null, osmTimestamp: null, features: false, gen: null, nextAt: 0, retryAt: 0, loading: null, tried: false }

function isoSeconds(v) {
  if (v instanceof Date) return v.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return v == null ? null : String(v)
}

// Holds the instance's single SQL slot (see `active`) for its duration
async function loadCoverage(gen) {
  active++
  try {
    const [rows] = await runQuery(
      // features_version: written into gate_report by the loader (no new column, so this
      // read works before and after database/phase12-poi-features.sql)
      `SELECT ${HINT} build_id, schema_version, osm_timestamp, coverage, JSON_EXTRACT(gate_report, '$.features_version') AS features_version ` +
        "FROM poi_builds WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1",
      [], 2500
    )
    const row = rows[0]
    const cells = typeof row?.coverage === 'string' ? JSON.parse(row.coverage) : row?.coverage
    if (!row || row.schema_version !== POI_SCHEMA_VERSION || !Array.isArray(cells)) {
      Object.assign(coverage, { cells: null, buildId: null, osmTimestamp: null, features: false })
    } else {
      Object.assign(coverage, { cells: new Set(cells), buildId: row.build_id, osmTimestamp: isoSeconds(row.osm_timestamp),
        features: Number(row.features_version) === FEATURES_VERSION })
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

// No verdict (the run never touched the shared path): only free a half-open probe slot
function breakerRelease() {
  breaker.probing = false
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

// The cap's own breaker: capped runs (the transaction and a fallback after it) that fail or
// are slower than the caller's wait count HERE, never on the shared breaker above, so a slow
// dense London can't switch DB serving off for towns. Open, dense tiles take today's
// (uncapped) path; after BREAKER_OPEN_MS the next dense tile tries again.
const capBreaker = { fails: 0, openUntil: 0 }
const capAllowed = () => capBreaker.fails < BREAKER_FAILURES || Date.now() >= capBreaker.openUntil
function capBreakerResult(ok) {
  if (ok) capBreaker.fails = 0
  else if (++capBreaker.fails >= BREAKER_FAILURES) capBreaker.openUntil = Date.now() + BREAKER_OPEN_MS
}
export const capBreakerState = () => (capAllowed() ? 'closed' : 'open')

// ponytail: per-instance only; add a CDN-cacheable GET endpoint if DB CPU becomes the limit (plan §4)
const LRU_TTL_MS = 10 * 60 * 1000
const lru = new Map() // cacheKey -> { at, value, bytes }, least recently used first
let lruBytes = 0
const inflight = new Map()
// Admission control: the pool has ONE connection, so a second query would only
// queue behind the first and outlive the caller's deadline
let active = 0
// LRU value meaning "too big for the DB path": skip the scan for 10 minutes
const OVER_CAP = Symbol('over cap')

const OVER_CAP_BYTES = 64 // a marker still costs something, so a flood of them is bounded too

function forget(cacheKey) {
  const entry = lru.get(cacheKey)
  if (!entry) return
  lruBytes -= entry.bytes
  lru.delete(cacheKey)
}

function remember(cacheKey, value, bytes = OVER_CAP_BYTES) {
  forget(cacheKey)
  lru.set(cacheKey, { at: Date.now(), value, bytes })
  lruBytes += bytes
  // Oldest first; an entry is at most LRU_ENTRY_MAX_BYTES, so the new one always stays
  for (const oldest of lru.keys()) {
    if (lruBytes <= LRU_BUDGET_BYTES) break
    forget(oldest)
  }
}

/** Test hook: { entries, bytes } held by the LRU. */
export const lruUsage = () => ({ entries: lru.size, bytes: lruBytes })

/**
 * Serve a plan from the DB when it can be: returns { body, n, ids, buildId, ms, cached }
 * (plus { scanned, rankMs, timings } for a capped answer) or null (not covered, too big,
 * busy, too close to the deadline, breaker open, DB error). Never throws. `key`
 * identifies the query (the snapped query string). `gen` is the roam:poiGen
 * generation: results are only served and cached for coverage loaded under the
 * same generation. `deadlineAt` is when the caller stops waiting. (Shadow uses
 * shadowPois, never this.)
 * `cap`: this request may be capped (poiCapPct). It takes effect
 * only for a rankable plan on a build with this code's features while the cap
 * breaker is closed; capped and uncapped answers are cached apart.
 */
export async function getPois(plan, key, { gen = 0, deadlineAt = Infinity, cap = false } = {}) {
  const cov = await getCoverage(gen, deadlineAt)
  if (cov.gen !== gen || !isCovered(plan, cov)) return null
  const { buildId } = cov
  const capOn = cap && cov.features && isRankable(plan) && capAllowed()
  const cacheKey = `${gen}|${buildId}|${capOn ? 'cap' : 'all'}|${key}`
  const hit = lru.get(cacheKey)
  const fresh = hit && Date.now() - hit.at < LRU_TTL_MS
  if (fresh && hit.value === OVER_CAP) return null
  if (fresh) {
    lru.delete(cacheKey) // most recently used again; bytes unchanged
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
      const result = await queryPois(plan, { osmTimestamp: cov.osmTimestamp, deadlineAt, features: capOn, buildId })
      // Cache only under a build still confirmed for this generation
      const confirmed = coverage.gen === gen && coverage.buildId === buildId
      // Too slow is a failure: the caller already gave up and served the old path. The shared
      // breaker judges ONLY today's statement (its own time; none at all for a capped answer);
      // the probe and the capped transaction are the cap breaker's
      if (result.sharedMs == null) breakerRelease()
      else breakerResult(result.sharedMs <= POI_DEADLINE_MS)
      if (capOn) capBreakerResult(Date.now() - started - (result.sharedMs ?? 0) <= POI_CAP_DEADLINE_MS)
      // A fallback is today's answer from a run that doubted the cap: never cached, so the
      // next request checks again (and the answer never outlives the table it came from)
      const cacheable = confirmed && !result.capFallback
      if (result.truncated) {
        console.warn('[poi] over the size cap, using the legacy path')
        if (cacheable) remember(cacheKey, OVER_CAP)
        return null
      }
      const value = { ...result, buildId }
      const bytes = Buffer.byteLength(result.body)
      if (cacheable && result.n > 0 && bytes <= LRU_ENTRY_MAX_BYTES) remember(cacheKey, value, bytes)
      return { ...value, ms: Date.now() - started, cached: false }
    } catch (err) {
      // A cap error (probe or transaction: today's statement never ran) is the cap's alone
      if (err.cap) {
        capBreakerResult(false)
        breakerRelease()
      } else breakerResult(false)
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

// ─── Shadow: measure the DB (and the cap) without touching served traffic ───

// Shadow runs never use the instance's pool connection, its admission slot, the shared
// breaker or the answer cache: each runs on its own short-lived connection, only while this
// instance has no served query in flight, one at a time, and at most once per tile per
// SHADOW_TTL_MS. Coverage is refreshed exactly as a served request would (getCoverage: one
// small read, only when the instance is idle), so shadow works at poiDbPct 0. The cap
// breaker is shared with served capped runs (the same signal: the cap is slow or failing).
const SHADOW_TTL_MS = 10 * 60 * 1000
const SHADOW_SEEN_MAX = 1000
const shadowSeen = new Map() // gen|build|key -> at
let shadowActive = false
// Worst case: one extra DB connection per warm nearby instance, for one shadow run's length
// (a shadow runs one at a time per instance). If opening one fails (ER_CON_COUNT_ERROR: the
// server is out of connections, or any other connect error), shadow stops on this instance
// for SHADOW_CONNECT_BACKOFF_MS, and a run never retries its connect.
const SHADOW_CONNECT_BACKOFF_MS = 60 * 1000
let shadowConnectBlockedUntil = 0

/**
 * The DB's answer for a query the caller has already served, for comparison logs:
 * { body, n, ids, buildId, ms, scanned?, rankMs?, timings, capFallback? } or null (not
 * covered, busy, seen recently, cap breaker irrelevant, DB error). Never throws. A rankable
 * plan on a features build is capped (while the cap breaker is closed), whatever poiCapPct.
 */
export async function shadowPois(plan, key, { gen = 0 } = {}) {
  if (active > 0 || shadowActive) return null // served traffic first
  if (Date.now() < shadowConnectBlockedUntil) return null // backing off after a failed connect
  const cov = await getCoverage(gen)
  if (cov.gen !== gen || !isCovered(plan, cov)) return null
  if (active > 0 || shadowActive) return null // again: the coverage read may have waited
  const seenKey = `${gen}|${cov.buildId}|${key}`
  const seenAt = shadowSeen.get(seenKey)
  if (seenAt !== undefined && Date.now() - seenAt < SHADOW_TTL_MS) return null
  shadowSeen.delete(seenKey)
  shadowSeen.set(seenKey, Date.now())
  if (shadowSeen.size > SHADOW_SEEN_MAX) shadowSeen.delete(shadowSeen.keys().next().value)
  const capOn = cov.features && isRankable(plan) && capAllowed()
  shadowActive = true
  let conn = null
  const started = Date.now()
  try {
    try {
      conn = await dedicatedConnection()
    } catch (err) {
      shadowConnectBlockedUntil = Date.now() + SHADOW_CONNECT_BACKOFF_MS
      console.warn(`[poi] shadow connect failed (${err.code || err.message}); no shadow here for ${SHADOW_CONNECT_BACKOFF_MS / 1000} s`)
      return null
    }
    const result = await queryPois(plan, { osmTimestamp: cov.osmTimestamp, features: capOn, buildId: cov.buildId, conn })
    // Shadow never moves the cap breaker: it runs on its own fresh connection (TLS handshake,
    // cold pages) and serves no one, so its slowness tripped the cap off for real users
    return result.truncated ? null : { ...result, buildId: cov.buildId, ms: Date.now() - started, cached: false }
  } catch (err) {
    console.warn('[poi] shadow query failed:', err.message)
    conn?.destroy?.()
    conn = null
    return null
  } finally {
    shadowActive = false
    if (conn) await conn.end().catch(() => conn.destroy?.())
  }
}

/** Test hook: forget all per-instance state. */
export function _resetPoiState() {
  Object.assign(coverage, { cells: null, buildId: null, osmTimestamp: null, features: false, gen: null, nextAt: 0, retryAt: 0, loading: null, tried: false })
  active = 0
  Object.assign(genCache, { value: 0, at: 0, loading: null, loadingAt: 0 })
  Object.assign(breaker, { fails: 0, openUntil: 0, probing: false })
  Object.assign(capBreaker, { fails: 0, openUntil: 0 })
  shadowSeen.clear()
  shadowActive = false
  shadowConnectBlockedUntil = 0
  lru.clear()
  lruBytes = 0
  inflight.clear()
}
