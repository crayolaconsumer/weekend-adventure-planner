/**
 * Answers the same Overpass subset as getPois (api/lib/poiQuery.js), from the
 * static block files (shared/poiTiles.mjs) instead of MySQL: same plan
 * (parseQuery), same matching, same relevance cap, same envelope.
 *
 * getTilePois(plan, key, { store, cap }) -> { body, n, ids, buildId, ms, cached, bytesRead, ... } or null
 * (not covered, too much to read, too big an answer, store error). Area plans read
 * cells; id plans (node(N)...) go through the build's id index (idRows).
 * Never throws; null means "use another path", exactly like getPois.
 * tilePois (bottom) wraps it for live traffic: answer LRU, in-flight dedupe, breaker.
 *
 * How it matches the SQL (poiQuery.js groupWhere/statementSql/buildSql):
 * - rows come from the cells of the bbox padded by CELL_PAD_DEG (cellRanges, the
 *   same function), plus every LARGE_CELL row; then the bounds test
 *   max_lat >= s AND min_lat <= n AND max_lon >= w AND min_lon <= e (the columns
 *   are DOUBLE and so are these: the same comparison);
 * - a statement matches on osm_type IN types, every k_<key> exactly one of its
 *   values (utf8mb4_0900_bin is exact: JS ===), has_name_tag / has_wikidata;
 *   a group is the OR of its statements, so a row is in a group at most once;
 * - each group in (osm_type, osm_id) order, LIMIT out-limit or SCAN_ROWS + 1;
 *   groups concatenated in order (UNION ALL ... ORDER BY g, osm_type, osm_id);
 * - the cap as queryPois/cappedAnswer: over CAP matches on a rankable plan of a
 *   features build, RANK_SCAN_ROWS / CAP_MIN_ELIGIBLE checks, rankCap on the
 *   (osm_type, osm_id)-ordered candidates around the bbox centre.
 * Builds are immutable files, so the DB path's build-mismatch fallback has no
 * counterpart here.
 */
import { cellRanges, CELL_PAD_DEG, LARGE_CELL, SCHEMA_VERSION } from '../../shared/poiCell.mjs'
import { blockKey, blockOf, decodeHeader, decodeIdHeader, decodeRowsAsync, findIdCell, idShardOf, idsKey, largeKey, HEADER_BYTES, ID_HEADER_BYTES } from '../../shared/poiTiles.mjs'
import { r2Store } from './poiStore.js'
import { rankCap, FEATURES_VERSION, ELIGIBLE, CAP } from '../../shared/poiRank.mjs'
import { isRankable, toAnswer, SCAN_ROWS, RANK_SCAN_ROWS, CAP_MIN_ELIGIBLE } from './poiQuery.js'
import { SNAP_GRID_DEGREES } from './bboxSnap.js'

// Compressed bytes one answer may read. London 30 km (the densest box the app sends)
// reads 5.7 MB (15 km: 4.4 MB); anything over this is a pathological box and falls back.
export const MAX_READ_BYTES = 12_000_000
// Cells closer than this in a block are read in one range (S3/R2 take one range per GET).
// Measured on 55 replay queries: one span per block read 63% more bytes than the cells;
// 64 KB reads 16% more, in ~5 parallel GETs per query instead of 12 for exact runs.
export const RANGE_GAP_BYTES = 64 * 1024
const MANIFEST_TTL_MS = 60 * 1000
// Decoded headers by object key: keys are content-addressed, so an entry never goes stale
export const HEADER_LRU_MAX = 2048

// Decodes: a London-sized read is ~5 MB of brotli -> ~100 MB of rows (~130 ms of CPU). They run
// on the threadpool (decodeRowsAsync), at most DECODE_CONCURRENCY at once per instance, so N
// dense tiles at once neither stall the event loop nor hold N x 100 MB; the rest queue (FIFO)
export const DECODE_CONCURRENCY = 2
let decoding = 0
const decodeQueue = []
// `timing.queueMs` gets the time spent waiting for a slot: local CPU, not R2 (the breaker
// leaves it out, so a burst of dense tiles queueing here can't look like a slow R2)
let decodesTotal = 0
export async function decodeLimited(buf, timing = null) {
  decodesTotal++
  if (decoding >= DECODE_CONCURRENCY) {
    const queued = Date.now()
    await new Promise(resolve => decodeQueue.push(resolve))
    // max, not sum: a request's cell decodes queue in parallel, so their waits overlap (a sum
    // could exceed the request itself and hide a slow R2). Sequential waits are under-counted,
    // which only errs toward opening the breaker (the DB), never toward Overpass.
    if (timing) timing.queueMs = Math.max(timing.queueMs || 0, Date.now() - queued)
  } else decoding++
  try {
    return await decodeRowsAsync(buf)
  } finally {
    const next = decodeQueue.shift()
    if (next) next() // the slot passes straight to the next in line
    else decoding--
  }
}
/** Decodes running or queued at their limit: background work (the shadow) should wait its turn. */
export const tilesBusy = () => decoding >= DECODE_CONCURRENCY
/** Test hook: { running, queued }. */
export const decodeState = () => ({ running: decoding, queued: decodeQueue.length, total: decodesTotal })

let manifests = new WeakMap() // store -> Map object key -> { at, value, loading }
const headers = new Map() // key -> decoded header, least recently used first
// LARGE_CELL rows by object key (a promise, so concurrent cold reads share one GET). Two builds:
// shadow (the DB's build) and serving can differ for a while after a nightly swap
const largeCache = new Map()
const LARGE_BUILDS = 2

/**
 * One JSON object, cached per store: `ttl` ms for a found one (Infinity: immutable), MANIFEST_TTL_MS
 * for a missing one. One read at a time; a failed read keeps serving the last good value.
 */
async function cachedJson(store, key, ttl, cachedOnly = false) {
  if (!manifests.has(store)) manifests.set(store, new Map())
  const cache = manifests.get(store)
  const hit = cache.get(key)
  if (cachedOnly) return hit?.value ?? null // breaker open: what is in memory, whatever its age
  if (hit?.at && Date.now() - hit.at < (hit.value ? ttl : MANIFEST_TTL_MS)) return hit.value
  if (hit?.loading) return hit.loading
  const loading = store.get(key).then(buf => (buf ? JSON.parse(buf) : null))
  cache.set(key, { ...hit, loading })
  try {
    const value = await loading
    cache.set(key, { at: Date.now(), value })
    return value
  } catch (err) {
    cache.set(key, { ...hit, loading: null })
    if (hit?.value) return hit.value
    throw err
  }
}

/**
 * The build to serve. `buildId` (the DB's active build, poiQuery activePoiBuild): its own
 * manifest, so tiles answer from exactly the build the DB holds, after a rollback too; the
 * nightly job uploads it before the DB swaps. Unknown or not uploaded: current.json's.
 */
export async function loadManifest(store, buildId = null, { exact = false, cachedOnly = false } = {}) {
  if (buildId && /^[\w-]+$/.test(buildId)) {
    const m = await cachedJson(store, `manifests/${buildId}.json`, Infinity, cachedOnly)
    if (m || exact) return m
  } else if (exact) return null
  const cur = await cachedJson(store, 'current.json', MANIFEST_TTL_MS, cachedOnly)
  return cur ? cachedJson(store, cur.manifest, Infinity, cachedOnly) : null
}

/** Header LRU (exported for tests). */
export function headerCacheGet(key) {
  const h = headers.get(key)
  if (h) {
    headers.delete(key)
    headers.set(key, h)
  }
  return h
}
export function headerCacheSet(key, h) {
  headers.delete(key)
  headers.set(key, h)
  while (headers.size > HEADER_LRU_MAX) headers.delete(headers.keys().next().value)
}
export const headerCacheSize = () => headers.size

async function getHeader(store, key, bytes = HEADER_BYTES, decode = decodeHeader) {
  const hit = headerCacheGet(key)
  if (hit) return hit
  const h = decode(await store.getRange(key, 0, bytes - 1))
  headerCacheSet(key, h)
  return h
}

async function readExact(store, key, start, length) {
  const buf = await store.getRange(key, start, start + length - 1)
  if (buf.length !== length) throw new Error(`short read ${key}: ${buf.length} of ${length}`)
  return buf
}

/**
 * An id plan (node(N), way(N)...: lookupPlace) from the id index: index header (cached) ->
 * the id's shard -> its cell -> that cell's rows, or LARGE_CELL's. Same answer as the DB's
 * `osm_type = ? AND osm_id = ?`: the row if the build has it, else an empty envelope.
 */
async function idRows(store, m, stmt, trace) {
  if (!m.ids) return null
  const key = idsKey(m.ids)
  const shard = (await getHeader(store, key, ID_HEADER_BYTES, decodeIdHeader))[idShardOf(stmt.id)]
  trace.bytesRead = shard.length
  trace.reads = shard.length ? 1 : 0
  const cell = shard.length ? findIdCell(await readExact(store, key, ID_HEADER_BYTES + shard.offset, shard.length), stmt.type, stmt.id) : null
  if (cell === null) return []
  let rows
  if (cell === LARGE_CELL) rows = await largeRows(store, m.large, trace)
  else {
    const { block, idx } = blockOf(cell)
    if (!m.blocks[block]) throw new Error(`id index names block ${block}, not in the build`)
    const bk = blockKey(block, m.blocks[block])
    const c = (await getHeader(store, bk)).cells[idx]
    rows = c.length ? await decodeLimited(await readExact(store, bk, HEADER_BYTES + c.offset, c.length), trace) : []
    trace.bytesRead += c.length
    trace.reads++
  }
  return rows.filter(r => r.osm_type === stmt.type && r.osm_id === stmt.id)
}

function largeRows(store, sha, timing = null) {
  const key = largeKey(sha)
  if (!largeCache.has(key)) {
    const rows = store.get(key).then(buf => {
      if (!buf) throw new Error(`missing ${key}`)
      return decodeLimited(buf, timing)
    })
    rows.catch(() => largeCache.delete(key)) // a failed read is retried by the next request
    largeCache.set(key, rows)
    while (largeCache.size > LARGE_BUILDS) largeCache.delete(largeCache.keys().next().value)
  }
  return largeCache.get(key)
}

/** Cell ranges -> Map block -> sorted idx list. */
function byBlock(ranges) {
  const out = new Map()
  for (const [lo, hi] of ranges) {
    for (let c = lo; c <= hi; c++) {
      const { block, idx } = blockOf(c)
      if (!out.has(block)) out.set(block, [])
      out.get(block).push(idx)
    }
  }
  for (const list of out.values()) list.sort((a, b) => a - b)
  return out
}

/** One statement of a plan -> row predicate (the SQL of statementSql). Exported for tests. */
export function statementPredicate(stmt) {
  const types = new Set(stmt.types)
  const keys = Object.entries(stmt.keys).map(([k, vs]) => [`k_${k}`, new Set(vs)])
  return r => types.has(r.osm_type) &&
    keys.every(([field, vs]) => vs.has(r[field])) &&
    (!stmt.name || r.has_name_tag === 1) &&
    (!stmt.wikidata || r.has_wikidata === 1)
}

/** The bounds test of groupWhere. Exported for tests. */
export const boundsPredicate = ({ s, w, n, e }) => r => r.max_lat >= s && r.min_lat <= n && r.max_lon >= w && r.min_lon <= e

const byOsm = (a, b) => a.osm_type - b.osm_type || a.osm_id - b.osm_id

/**
 * Candidate rows -> the answer, as queryPois would give it. Pure (exported for tests):
 * { body, n, ids, scanned?, capPath?, capFallback? } or { truncated: true }.
 */
export function answerFromRows(plan, rows, { osmTimestamp, capOn = false } = {}) {
  const inBox = boundsPredicate(plan.bbox)
  const boxed = rows.filter(inBox)
  const groups = plan.groups.map(group => {
    const preds = group.statements.map(statementPredicate)
    return boxed.filter(r => preds.some(p => p(r))).sort(byOsm)
  })
  const today = () => toAnswer(plan, groups.flatMap((list, g) =>
    list.slice(0, plan.groups[g].limit || SCAN_ROWS + 1).map(r => ({ ...r, g }))), osmTimestamp)
  if (!capOn || !isRankable(plan) || groups[0].length <= CAP) return today()
  const candidates = groups[0]
  const scanned = candidates.length
  if (scanned > RANK_SCAN_ROWS) return { truncated: true }
  let eligible = 0
  for (const c of candidates) if (c.flags & ELIGIBLE) eligible++
  if (eligible < CAP_MIN_ELIGIBLE * scanned) return { ...today(), capPath: true, capFallback: 'features' }
  const { s, w, n, e } = plan.bbox
  const chosen = rankCap(candidates, { lat: (s + n) / 2, lng: (w + e) / 2 }, CAP, SNAP_GRID_DEGREES / 2)
  const answer = toAnswer(plan, chosen.map(r => ({ ...r, g: 0 })), osmTimestamp)
  return answer.truncated ? answer : { ...answer, scanned, capPath: true }
}

/**
 * Serve a plan from the block store. `store`: { get, getRange } (api/lib/poiStore.js).
 * `cap`: this request may be capped (poiCapPct), as getPois. `trace`: optional object
 * filled with { why, bytesRead, reads, blocks } (for logs and the parity harness).
 */
export async function getTilePois(plan, key, { store, cap = false, buildId = null, manifest = null, maxReadBytes = MAX_READ_BYTES, rangeGapBytes = RANGE_GAP_BYTES, trace = {} } = {}) {
  const started = Date.now()
  const no = why => { trace.why = why; return null }
  try {
    if (!plan || (plan.kind !== 'area' && plan.kind !== 'id')) return no('not_ours')
    const m = manifest || await loadManifest(store, buildId)
    if (!m || m.schema_version !== SCHEMA_VERSION) return no('no_build')
    const osmTimestamp = m.osm_timestamp?.replace(/\.\d{3}Z$/, 'Z')
    if (plan.kind === 'id') {
      const rows = await idRows(store, m, plan.groups[0].statements[0], trace)
      if (!rows) return no('no_ids')
      const answer = toAnswer(plan, rows.map(r => ({ ...r, g: 0 })), osmTimestamp)
      return { ...answer, buildId: m.build_id, ms: Date.now() - started, cached: false, bytesRead: trace.bytesRead }
    }
    if (!plan.bbox) return no('not_ours')
    const { s, w, n, e } = plan.bbox
    const inner = byBlock(cellRanges(s, w, n, e))
    for (const b of inner.keys()) if (!m.blocks[b]) return no('not_covered')
    const need = byBlock(cellRanges(s - CELL_PAD_DEG, w - CELL_PAD_DEG, n + CELL_PAD_DEG, e + CELL_PAD_DEG))
    const blocks = [...need.keys()].filter(b => m.blocks[b])
    const hdrs = new Map(await Promise.all(blocks.map(async b => [b, await getHeader(store, blockKey(b, m.blocks[b]))])))
    // Covered = every cell of the unpadded box covered (isCovered); padded cells only add rows
    for (const [b, list] of inner) for (const idx of list) if (!hdrs.get(b).covered[idx]) return no('not_covered')

    // Needed non-empty cells, coalesced into ranges across gaps up to RANGE_GAP_BYTES
    const reads = []
    let bytes = 0
    for (const b of blocks) {
      const key = blockKey(b, m.blocks[b])
      const cells = need.get(b).map(idx => hdrs.get(b).cells[idx]).filter(c => c.length).sort((x, y) => x.offset - y.offset)
      for (const c of cells) {
        const last = reads[reads.length - 1]
        if (last?.key === key && c.offset - last.end <= rangeGapBytes) {
          last.end = c.offset + c.length
          last.cells.push(c)
        } else reads.push({ key, start: c.offset, end: c.offset + c.length, cells: [c] })
      }
    }
    for (const r of reads) bytes += r.end - r.start
    Object.assign(trace, { bytesRead: bytes, reads: reads.length, blocks: blocks.length })
    if (bytes > maxReadBytes) return no('read_cap')

    const parts = await Promise.all([
      largeRows(store, m.large, trace),
      ...reads.map(async r => {
        const buf = await readExact(store, r.key, HEADER_BYTES + r.start, r.end - r.start)
        return (await Promise.all(r.cells.map(c => decodeLimited(buf.subarray(c.offset - r.start, c.offset - r.start + c.length), trace)))).flat()
      }),
    ])
    const capOn = cap && m.features_version === FEATURES_VERSION && isRankable(plan)
    const answer = answerFromRows(plan, parts.flat(), { osmTimestamp, capOn })
    if (answer.truncated) return no('too_big')
    return { ...answer, buildId: m.build_id, ms: Date.now() - started, cached: false, bytesRead: bytes }
  } catch (err) {
    console.warn('[poi-tiles] failed:', err.message)
    return no('error')
  }
}

// ─── Serving wrapper (nearby.js): store from env, answer LRU, in-flight dedupe, breaker ───

// Per R2 GET. Vercel lhr1 -> R2 (Western Europe): measure with /api/admin/poi-tiles
export const TILES_GET_TIMEOUT_MS = 2000
// An answer slower than this counts as a breaker failure even when it lands
export const TILES_SLOW_MS = 1500
const BREAKER_FAILURES = 3
const BREAKER_OPEN_MS = 60 * 1000
// Answers by build|cap|query. Builds are immutable, so an entry never goes stale: no TTL. Any
// answer is kept (MAX_BODY_BYTES, 4 MB, is the largest), so a repeat never re-reads R2 while in
// it. The budget counts memory as V8 holds it (answerCost), not UTF-8 bytes
export const TILES_LRU_BUDGET_BYTES = 16_000_000
let lruBudget = TILES_LRU_BUDGET_BYTES
/** Test hook: a smaller budget, so the eviction test needs few entries (reset by _resetTileState). */
export const _setTilesLruBudget = bytes => { lruBudget = bytes }
const OVER = Symbol('too big for tiles') // the answer is past the read or body cap: don't read it again
const OVER_BYTES = 64

let envStore // undefined: not made yet; null: R2 not configured here
const answers = new Map() // cacheKey -> { value, bytes }, least recently used first
let answerBytes = 0
const inflight = new Map()
const breaker = { fails: 0, openUntil: 0, probing: false }

/** Is R2 configured on this deployment? (shadow is skipped when it isn't) */
export const tilesConfigured = () => tilesStore() !== null

/** The serving store: R2 from env (read-only token), or null when not configured. */
export function tilesStore() {
  if (envStore === undefined) {
    try {
      envStore = r2Store({ timeoutMs: TILES_GET_TIMEOUT_MS })
    } catch (err) {
      console.warn('[poi-tiles] off:', err.message) // once per instance: R2 env not set here
      envStore = null
    }
  }
  return envStore
}

export const tilesBreakerState = () => (breaker.fails < BREAKER_FAILURES ? 'closed' : Date.now() < breaker.openUntil ? 'open' : 'half-open')
function breakerAllows() {
  if (breaker.fails < BREAKER_FAILURES) return true
  if (Date.now() < breaker.openUntil || breaker.probing) return false
  breaker.probing = true
  return true
}
function breakerResult(ok) {
  breaker.probing = false
  if (ok) breaker.fails = 0
  else if (++breaker.fails >= BREAKER_FAILURES) breaker.openUntil = Date.now() + BREAKER_OPEN_MS
}

/**
 * What an answer costs in memory, roughly as V8 holds it: the body is one byte per character when
 * it is all Latin-1 and two otherwise (Welsh ŵ, emoji: UTF-16), plus the ids array (its strings
 * and ~32 bytes of overhead each). Exported for tests.
 */
export function answerCost(r) {
  let ids = 0
  for (const id of r.ids) ids += id.length + 32
  return r.body.length * (/[\u0100-\uffff]/.test(r.body) ? 2 : 1) + ids
}

function remember(cacheKey, value, bytes) {
  const old = answers.get(cacheKey)
  if (old) answerBytes -= old.bytes
  answers.delete(cacheKey)
  answers.set(cacheKey, { value, bytes })
  answerBytes += bytes
  for (const [k, e] of answers) {
    if (answerBytes <= lruBudget) break
    answers.delete(k)
    answerBytes -= e.bytes
  }
}
/** Test hook: { entries, bytes } held by the answer LRU. */
export const tilesLruUsage = () => ({ entries: answers.size, bytes: answerBytes })

/**
 * getTilePois for live traffic: { body, n, ids, buildId, ms, cached, bytesRead, ... } or null
 * (R2 not configured, breaker open, not covered, too big, R2 error or timeout). Never throws.
 * `buildId`: the DB's active build when known (see loadManifest); `exact`: that build or nothing
 * (never current.json's, which may be the build a rollback just left). `trace` gets { why, cached,
 * joined, bytesRead, reads } for logs. R2 failing or slower than TILES_SLOW_MS three times in a
 * row opens the breaker for a minute (then one probe): callers go to the DB meanwhile.
 */
export async function tilePois(plan, key, { cap = false, buildId = null, exact = false, trace = {}, store = tilesStore(), maxReadBytes = MAX_READ_BYTES } = {}) {
  const no = why => { trace.why = why; return null }
  if (!store || !plan) return no('off')
  // Breaker open: no R2 request at all (not even an expired manifest), but an answer this
  // instance already holds is still served: it costs R2 nothing
  const open = tilesBreakerState() === 'open'
  const started = Date.now()
  let m
  try {
    m = await loadManifest(store, buildId, { exact, cachedOnly: open })
  } catch (err) {
    breakerResult(false)
    console.warn('[poi-tiles] manifest failed:', err.message)
    return no('error')
  }
  if (!m) return no(open ? 'breaker' : 'no_build')
  const cacheKey = `${m.build_id}|${cap ? 'cap' : 'all'}|${key}`
  const hit = answers.get(cacheKey)
  if (hit) {
    remember(cacheKey, hit.value, hit.bytes) // most recently used again
    trace.cached = true
    return hit.value === OVER ? no('too_big') : { ...hit.value, ms: 0, cached: true }
  }
  if (inflight.has(cacheKey)) {
    // The read already running: its outcome (why, bytes) is this request's too
    const { run, trace: theirs } = inflight.get(cacheKey)
    return run.then(r => {
      Object.assign(trace, theirs, { joined: true })
      return r
    })
  }
  if (open || !breakerAllows()) return no('breaker')
  const t = {}
  const run = (async () => {
    const r = await getTilePois(plan, key, { store, cap, manifest: m, maxReadBytes, trace: t })
    const ms = Date.now() - started
    // Judged on R2 work: time queued for a decode slot (local CPU) is left out
    breakerResult(t.why !== 'error' && ms - (t.queueMs || 0) <= TILES_SLOW_MS)
    Object.assign(trace, t)
    if (r) {
      remember(cacheKey, r, answerCost(r))
      return { ...r, ms }
    }
    if (t.why === 'too_big' || t.why === 'read_cap') remember(cacheKey, OVER, OVER_BYTES)
    return null
  })().finally(() => inflight.delete(cacheKey))
  inflight.set(cacheKey, { run, trace: t })
  return run
}

/** Test hook: forget all per-instance state. */
export function _resetTileState() {
  headers.clear()
  largeCache.clear()
  manifests = new WeakMap()
  envStore = undefined
  answers.clear()
  answerBytes = 0
  lruBudget = TILES_LRU_BUDGET_BYTES
  inflight.clear()
  Object.assign(breaker, { fails: 0, openUntil: 0, probing: false })
}
