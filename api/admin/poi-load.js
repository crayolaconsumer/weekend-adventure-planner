/**
 * POST /api/admin/poi-load?build=<id>&step=begin|chunk|photos|finalize[&i=N][&force=1]
 * GET  /api/admin/poi-load?step=status  -> { active_build_id, active_release_tag, previous_release_tag, latest }
 *
 * Loads one nightly POI build (database/phase11-pois.sql) from OUR GitHub
 * Release into pois_staging / poi_photos_staging, then swaps it live with one
 * atomic RENAME once the finalize gates pass. Driven by the poi-build workflow
 * or scripts/poi/load.mjs, one short request per step so every call fits the
 * function budget and a failed call is simply re-sent.
 *
 * Auth: `Authorization: Bearer <POI_LOAD_SECRET>` (constant-time, fails closed
 * when unset), or an admin session through guardAdmin. force=1 always needs
 * the admin session, and even then only overrides the judgement gates
 * (G3-G7): schema, completeness and the LARGE bucket (G1, G2, G8) always hold. Every
 * auth reject is the admin 404. Errors never echo internals (Actions logs are
 * public): a 500 carries a request id, the detail stays in the function log.
 *
 * Safety:
 * - build must match BUILD_RE and every URL is RELEASE_BASE plus a fixed or
 *   regex-checked file name. Downloads are capped at 32 MB while streaming.
 * - Every step holds GET_LOCK('roam:poi-load') on a dedicated connection
 *   (outside the 1-connection pool) for the whole request; busy = 409 retry.
 *   The connection sets wait_timeout 150 s, so a frozen instance can't hold
 *   the lock for long. Swap and rollback DDL run on that connection with
 *   lock_wait_timeout 5 s; a timeout is 503 + Retry-After, never a hang.
 * - begin stamps the build id into the staging tables' COMMENT; RENAME carries
 *   it, so the live `pois` table always says which build it holds. reconcile()
 *   repairs poi_builds from that after a crash between RENAME and UPDATE.
 * - chunk: sha256 against the manifest, in-order only, 1,000-row upserts,
 *   then chunks_loaded = GREATEST(chunks_loaded, i+1): a true resume point.
 * - Live serving is only touched by the RENAME in swap().
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { gunzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withCors } from '../lib/cors.js'
import { guardAdmin } from '../lib/adminGuard.js'
import { query, update, dedicatedConnection } from '../lib/db.js'
import { sendEmail } from '../lib/email.js'
import { recordCronRun } from '../lib/cronRuns.js'
import { getClient } from '../lib/kvCache.js'
import * as poiCellMod from '../../shared/poiCell.mjs'

export const RELEASE_BASE = 'https://github.com/crayolaconsumer/weekend-adventure-planner/releases/download/'
export const BUILD_RE = /^[a-z]{2,8}-\d{8}T\d{4}Z$/
const CHUNK_RE = /^chunk-\d{3}\.ndjson\.gz$/
const FIXED_FILES = new Set(['manifest.json', 'coverage.json', 'photos.ndjson.gz'])
export const JOB_NAME = 'poi-load'
export const LOCK_NAME = 'roam:poi-load'
const BATCH_ROWS = 1000
export const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024
const MAX_INFLATED_BYTES = 128 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30000
const RETRY_AFTER_S = 5
const ALERT_EMAIL = process.env.MODERATION_ALERT_EMAIL || 'fittonj@gmail.com'

const K_COLS = ['k_amenity', 'k_tourism', 'k_leisure', 'k_historic', 'k_shop', 'k_natural', 'k_man_made']
export const POI_COLS = ['cell', 'osm_type', 'osm_id', 'lat', 'lon', 'min_lat', 'min_lon', 'max_lat', 'max_lon',
  ...K_COLS, 'has_name', 'has_name_tag', 'has_wikidata', 'el']
const PHOTO_COLS = ['photo_key', 'url', 'width', 'height', 'source', 'artist', 'license', 'license_url', 'page_url', 'checked_on']
const TYPE_NAMES = { 1: 'node', 2: 'way', 3: 'relation' }

// Row alias upsert (MySQL 8.0.19+; VALUES() in ODKU is deprecated)
const upsertSql = (table, cols, keyCols) =>
  `INSERT INTO ${table} (${cols.join(', ')}) VALUES ? AS new ON DUPLICATE KEY UPDATE ` +
  cols.filter(c => !keyCols.includes(c)).map(c => `${c} = new.${c}`).join(', ')
export const INSERT_POIS = upsertSql('pois_staging', POI_COLS, ['cell', 'osm_type', 'osm_id'])
export const INSERT_PHOTOS = upsertSql('poi_photos_staging', PHOTO_COLS, ['photo_key'])

// Finalize gates (plan §3). REQUIRED gates hold even under force.
export const REQUIRED_GATES = ['G1', 'G2', 'G8']
const FIRST_BUILD_MIN_ROWS = 150000
const VOLUME_MIN = 0.95
const VOLUME_MAX = 1.10
const MIX_TOLERANCE = 0.10
const SENTINEL_MIN = 0.90 // as the build's local gate: one remapped sentinel must not block every night
const QUERY_MIN = 0.85
const PHOTO_MIN = 0.9
const LARGE_ALERT = 1000 // more LARGE-bucket rows than this: alert, but still load
const largeCell = () => poiCellMod.LARGE_CELL ?? 0 // CONTRACT AMENDMENT 2
const G6_QUERY_TIMEOUT_MS = 5000
const GATE_SCAN_MS = 30000 // a full scan of staging (G2 count, G4 sums) on a t4g.micro
const GATE_MARGIN_MS = 25000 // kept back from every gate query: the swap reserve plus cleanup
const G6_BUDGET_MS = 60000 // of the 120 s function budget
const REQUEST_BUDGET_MS = 110000 // maxDuration 120 minus a margin
const SWAP_RESERVE_MS = 20000 // never start the RENAME with less than this left
export const MIX_KEYS = [
  'amenity=cafe', 'amenity=pub', 'amenity=restaurant', 'amenity=bar', 'amenity=place_of_worship',
  'leisure=park', 'leisure=garden', 'leisure=nature_reserve',
  'tourism=museum', 'tourism=attraction', 'tourism=viewpoint', 'historic=castle',
]
// G6 samples: 20 town pages + 10 Discover tiles
const G6_TOWNS = ['london', 'york', 'belfast', 'cardiff', 'luton', 'edinburgh', 'glasgow', 'manchester', 'birmingham', 'bristol',
  'leeds', 'liverpool', 'newcastle-upon-tyne', 'norwich', 'exeter', 'inverness', 'aberystwyth', 'bath', 'oxford', 'keswick']
const G6_DISCOVER = [
  ['London', 51.5074, -0.1278, 5000], ['London', 51.5074, -0.1278, 15000], ['London', 51.5074, -0.1278, 30000],
  ['York', 53.959, -1.0815, 5000], ['York', 53.959, -1.0815, 15000],
  ['Belfast', 54.5973, -5.9301, 5000], ['Belfast', 54.5973, -5.9301, 30000],
  ['Cardiff', 51.4816, -3.1791, 5000], ['Cardiff', 51.4816, -3.1791, 15000],
  ['Luton', 51.8787, -0.42, 5000],
]

class LoadError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra }
}
const retryLater = message => new LoadError(503, message, { retry: true })
const isLockWaitTimeout = err => err?.errno === 1205 || err?.code === 'ER_LOCK_WAIT_TIMEOUT'
const isQueryTimeout = err => err?.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || err?.errno === 3024 || err?.code === 'ER_QUERY_TIMEOUT'

export function isAuthorizedLoader(req) {
  const secret = process.env.POI_LOAD_SECRET
  if (!secret) return false
  const given = Buffer.from(String(req.headers?.authorization || ''))
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// ─── Lock + reconcile (shared with poi-rollback.js) ─────────────

// Inside a locked step EVERY statement runs on the locked connection, so a
// step can never outlive its lock: if that session dies (wait_timeout after a
// frozen instance) its next statement fails instead of writing through the
// pool into staging another loader now owns. Outside a lock: the pool.
const lockedConn = new AsyncLocalStorage()
export async function q(sql, params) {
  const conn = lockedConn.getStore()?.conn
  return conn ? (await conn.query(sql, params))[0] : query(sql, params)
}
export async function q1(sql, params) {
  const rows = await q(sql, params)
  return rows?.[0] || null
}
export async function u(sql, params) {
  const conn = lockedConn.getStore()?.conn
  return conn ? (await conn.query(sql, params))[0]?.affectedRows : update(sql, params)
}

/** Run fn(conn) holding the global POI lock on a connection outside the pool. */
export async function withPoiLock(fn) {
  let conn
  try { conn = await dedicatedConnection() } catch { throw retryLater('Database unavailable') }
  let held = false
  try {
    await conn.query('SET SESSION wait_timeout = 150, lock_wait_timeout = 5')
    const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME])
    if (Number(rows?.[0]?.got) !== 1) throw new LoadError(409, 'Another POI load or rollback is running', { retry: true })
    held = true
    const [[{ id } = {}] = []] = await conn.query('SELECT CONNECTION_ID() AS id')
    return await lockedConn.run({ conn, id: Number(id) }, () => fn(conn))
  } finally {
    if (held) await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {})
    // Closing the session releases the lock too, whatever happened above
    await conn.end().catch(() => conn.destroy?.())
  }
}

/**
 * A validation query with a SERVER-side limit (MAX_EXECUTION_TIME on the outer
 * SELECT: the server stops it and frees the connection) sized to what is left
 * of the request. A client timeout alone leaves the query running on the
 * shared micro instance, so if mysql2 gives up first the query is killed from
 * a fresh connection. Either way the answer is "inconclusive": retryable 503.
 */
export async function gateQuery(sql, params, { capMs, deadline = Infinity }) {
  const limitMs = Math.floor(Math.min(capMs, deadline - Date.now() - GATE_MARGIN_MS))
  if (limitMs < 1000) throw retryLater('Not enough time left to validate; re-send finalize')
  if (!/^SELECT /.test(sql)) throw new Error('gateQuery needs a SELECT')
  const hinted = `SELECT /*+ MAX_EXECUTION_TIME(${limitMs}) */ ${sql.slice(7)}`
  try {
    return await q({ sql: hinted, timeout: limitMs + 2000 }, params)
  } catch (err) {
    if (!isQueryTimeout(err)) throw err
    if (err.code === 'PROTOCOL_SEQUENCE_TIMEOUT') await killLockedQuery()
    throw retryLater('A validation query ran out of time; re-send finalize')
  }
}
const gateOne = async (sql, params, opts) => (await gateQuery(sql, params, opts))?.[0] || null

async function killLockedQuery() {
  const id = lockedConn.getStore()?.id
  if (!Number.isSafeInteger(id)) return
  let killer
  try {
    killer = await dedicatedConnection()
    await killer.query('KILL QUERY ?', [id])
  } catch (err) {
    console.error('[poi-load] KILL QUERY failed:', err?.message || err)
  } finally {
    await killer?.end().catch(() => killer.destroy?.())
  }
}

/**
 * poi_builds from the tables themselves: the live `pois` COMMENT names the
 * live build (RENAME carries it). Fixes a crash between a RENAME and its
 * status UPDATE. A build found in pois_failed was rolled back; any other
 * displaced active build becomes previous. Returns the live build id.
 */
export async function reconcile() {
  const tables = await q(
    `SELECT table_name AS name, table_comment AS owner FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN ('pois', 'pois_failed')`)
  const live = tables.find(t => t.name === 'pois')?.owner
  if (!BUILD_RE.test(live || '')) return null
  const row = await q1('SELECT status FROM poi_builds WHERE build_id = ?', [live])
  if (!row || row.status === 'active') return live
  const failedOwner = tables.find(t => t.name === 'pois_failed')?.owner || ''
  // activated_at first: MySQL applies SET left to right, so status is still the old one here
  await u(
    `UPDATE poi_builds SET
       activated_at = IF(build_id = ? AND status <> 'previous', NOW(), activated_at),
       status = CASE WHEN build_id = ? THEN 'active' WHEN build_id = ? THEN 'rolled_back' ELSE 'previous' END
     WHERE status = 'active' OR build_id = ?`, [live, live, failedOwner, live])
  console.warn(`[poi-load] reconciled poi_builds: ${live} is live`)
  return live
}

async function tableOwners(names) {
  const rows = await q(
    `SELECT table_name AS name, table_comment AS owner FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (${names.map(() => '?').join(', ')})`, names)
  return Object.fromEntries(rows.map(r => [r.name, r.owner]))
}

/**
 * The cache generation lives in its own KV key, bumped with an atomic INCR, so
 * it can never race an admin's flag change. Every instance compares it and
 * drops query results cached from the old tables. Never undoes a swap: a
 * failure is logged and emailed, and gen_pending makes the next begin,
 * finalize or rollback try again.
 */
export const KV_POI_GEN_KEY = 'roam:poiGen'
export async function bumpPoiGen(reason) {
  let why
  try {
    const client = getClient()
    if (!client) why = 'KV not configured'
    else {
      const gen = Number(await client.incr(KV_POI_GEN_KEY))
      if (Number.isSafeInteger(gen)) return gen
      why = 'INCR returned no number'
    }
  } catch (err) {
    why = err?.message || String(err)
  }
  console.error(`[poi-load] poiGen bump after ${reason} failed: ${why}`)
  try {
    await sendEmail({
      to: ALERT_EMAIL,
      subject: '[ROAM ALERT] POI cache generation not bumped',
      text: `After ${reason}, INCR ${KV_POI_GEN_KEY} failed (${why}). The tables changed, but instances may serve ` +
        'cached results from the old ones. The next loader or rollback call retries automatically; INCR the key by hand to clear it now.',
    })
  } catch { /* already logged */ }
  return null
}

/** INCR once for every table change still waiting for it (gen_pending). */
export async function flushPoiGen(reason) {
  const pending = await q('SELECT build_id FROM poi_builds WHERE gen_pending = 1')
  if (!pending.length) return null
  const gen = await bumpPoiGen(reason)
  if (gen !== null) await u('UPDATE poi_builds SET gen_pending = 0 WHERE gen_pending = 1')
  return gen
}

/** Start of begin, finalize and rollback: repair statuses, retry a missed INCR. */
export async function recover() {
  const live = await reconcile()
  await flushPoiGen('recovery')
  return live
}

// ─── Release downloads ──────────────────────────────────────────

/** The only way a URL is made. Throws for anything but our release files. */
export function releaseUrl(build, file) {
  if (!BUILD_RE.test(build)) throw new LoadError(400, 'Bad build id')
  if (!FIXED_FILES.has(file) && !CHUNK_RE.test(file)) throw new LoadError(422, `Refusing release file name: ${String(file).slice(0, 80)}`)
  return `${RELEASE_BASE}poi-${build}/${file}`
}

async function fetchRelease(build, file, { optional = false } = {}) {
  const res = await fetch(releaseUrl(build, file), { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  const drop = () => res.body?.cancel().catch(() => {})
  if (res.status === 404 && optional) { await drop(); return null }
  if (!res.ok) { await drop(); throw new LoadError(502, `Release ${file}: HTTP ${res.status}`) }
  if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) { await drop(); throw new LoadError(422, `Release ${file} too large`) }
  const parts = []
  let size = 0
  // Leaving the loop early (the throw) cancels the stream: never buffer past the cap
  for await (const part of res.body || []) {
    size += part.length
    if (size > MAX_DOWNLOAD_BYTES) throw new LoadError(422, `Release ${file} too large`)
    parts.push(part)
  }
  return Buffer.concat(parts)
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max

export function validateManifest(m, build) {
  const bad = why => { throw new LoadError(422, `Bad manifest: ${why}`) }
  if (!m || typeof m !== 'object') bad('not an object')
  if (m.build_id !== build) bad('build_id mismatch')
  if (!isInt(m.schema_version, 0, 32767)) bad('schema_version')
  if (!m.osm_timestamp || Number.isNaN(Date.parse(m.osm_timestamp))) bad('osm_timestamp')
  if (!isInt(m.large_count, 0, 1e7)) bad('large_count')
  if (!Array.isArray(m.chunks) || !m.chunks.length || m.chunks.length > 999) bad('chunks')
  m.chunks.forEach((c, i) => {
    if (c?.name !== `chunk-${String(i).padStart(3, '0')}.ndjson.gz`) bad(`chunk ${i} name`)
    if (!/^[0-9a-f]{64}$/.test(c.sha256)) bad(`chunk ${i} sha256`)
    if (!isInt(c.rows, 1, 10000)) bad(`chunk ${i} rows`)
  })
  if (m.row_count !== m.chunks.reduce((n, c) => n + c.rows, 0)) bad('row_count does not match chunk rows')
  if (m.per_key_counts != null && typeof m.per_key_counts !== 'object') bad('per_key_counts')
  return m
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/** { value, digest }: the digest pins the exact release revision a load started from. */
async function fetchJson(build, file) {
  const buf = await fetchRelease(build, file)
  try { return { value: JSON.parse(buf.toString('utf8')), digest: sha256(buf) } } catch { throw new LoadError(422, `Bad ${file}: not JSON`) }
}
async function fetchManifest(build) {
  const { value, digest } = await fetchJson(build, 'manifest.json')
  return { manifest: validateManifest(value, build), digest }
}

/** The manifest, refused if manifest or coverage were re-uploaded since begin: never mix revisions. */
async function pinnedManifest(build, row) {
  const { manifest, digest } = await fetchManifest(build)
  if (digest !== row.manifest_sha256) throw new LoadError(409, 'Release manifest changed since begin; send step=begin to start again')
  const { digest: coverageDigest } = await fetchJson(build, 'coverage.json')
  if (coverageDigest !== row.coverage_sha256) throw new LoadError(409, 'Release coverage changed since begin; send step=begin to start again')
  return manifest
}

function ndjson(gz) {
  let text
  try { text = gunzipSync(gz, { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8') } catch {
    throw new LoadError(422, 'Bad gzip')
  }
  return text.split('\n').filter(l => l.trim()).map((l, n) => {
    try { return JSON.parse(l) } catch { throw new LoadError(422, `Bad JSON on line ${n + 1}`) }
  })
}

// ─── Row validation ─────────────────────────────────────────────

const strOrNull = (v, max) => v === null || (typeof v === 'string' && v.length >= 1 && v.length <= max)
const flag = v => v === 0 || v === 1

/** One chunk row -> column values in POI_COLS order. Throws on anything off-contract. */
export function toPoiRow(o, n = 0) {
  const bad = why => { throw new LoadError(422, `Bad row ${n}: ${why}`) }
  if (!o || typeof o !== 'object') bad('not an object')
  if (!TYPE_NAMES[o.osm_type]) bad('osm_type')
  if (!Number.isSafeInteger(o.osm_id) || o.osm_id <= 0) bad('osm_id')
  const lats = [o.lat, o.min_lat, o.max_lat]
  const lons = [o.lon, o.min_lon, o.max_lon]
  if (!lats.every(v => Number.isFinite(v) && Math.abs(v) <= 90) || !lons.every(v => Number.isFinite(v) && Math.abs(v) <= 180)) bad('lat/lon/bounds')
  if (!(o.min_lat <= o.lat && o.lat <= o.max_lat && o.min_lon <= o.lon && o.lon <= o.max_lon)) bad('centre outside bounds (or min > max)')
  // Wider than the query side's cell pad: stored in the LARGE bucket, which every query scans.
  // The build's own isLarge(), so build and loader can never disagree at the boundary
  if (typeof poiCellMod.isLarge !== 'function') bad('isLarge missing from shared/poiCell.mjs')
  const large = poiCellMod.isLarge(o)
  if (o.cell !== (large ? largeCell() : poiCellMod.poiCell(o.lat, o.lon))) {
    bad(large ? 'wide element must be in the LARGE cell' : 'cell does not match poiCell(lat, lon)')
  }
  for (const k of K_COLS) if (!strOrNull(o[k] ?? null, 48)) bad(k)
  if (!flag(o.has_name) || !flag(o.has_name_tag) || !flag(o.has_wikidata)) bad('has_* flags')
  // TEXT holds 65,535 BYTES; a multi-byte name would pass a character count
  if (typeof o.el !== 'string' || Buffer.byteLength(o.el, 'utf8') > 65535) bad('el')
  let el
  try { el = JSON.parse(o.el) } catch { bad('el is not JSON') }
  if (el?.type !== TYPE_NAMES[o.osm_type] || el.id !== o.osm_id) bad('el type/id mismatch')
  const tags = el.tags || {}
  if (o.has_name_tag !== (tags.name != null ? 1 : 0)) bad('has_name_tag disagrees with el tags')
  if (o.has_name !== (tags.name != null || tags['name:en'] != null ? 1 : 0)) bad('has_name disagrees with el tags')
  return POI_COLS.map(c => (K_COLS.includes(c) ? o[c] ?? null : o[c]))
}

const PHOTO_SOURCES = new Set(['wikidata', 'commons-osm', 'geograph'])
const httpsUrl = (v, max) => typeof v === 'string' && v.length <= max && v.startsWith('https://')

export function toPhotoRow(o, n = 0) {
  const bad = why => { throw new LoadError(422, `Bad photo row ${n}: ${why}`) }
  if (!o || typeof o !== 'object') bad('not an object')
  if (!strOrNull(o.photo_key, 64) || o.photo_key === null) bad('photo_key')
  if (!httpsUrl(o.url, 512)) bad('url')
  for (const d of ['width', 'height']) if (!(o[d] == null || isInt(o[d], 0, 65535))) bad(d)
  if (!PHOTO_SOURCES.has(o.source)) bad('source')
  if (!(o.artist == null || typeof o.artist === 'string')) bad('artist')
  if (!strOrNull(o.license, 64) || o.license === null) bad('license')
  if (!(o.license_url == null || (typeof o.license_url === 'string' && /^https?:\/\//.test(o.license_url) && o.license_url.length <= 255))) bad('license_url')
  if (!httpsUrl(o.page_url, 512)) bad('page_url')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.checked_on || '')) bad('checked_on')
  return [o.photo_key, o.url, o.width ?? null, o.height ?? null, o.source,
    o.artist ? o.artist.slice(0, 255) : null, o.license, o.license_url ?? null, o.page_url, o.checked_on]
}

async function upsertBatches(sql, rows) {
  for (let i = 0; i < rows.length; i += BATCH_ROWS) await q(sql, [rows.slice(i, i + BATCH_ROWS)])
}

// begin stamps the build id into both staging tables' COMMENT, so no step
// can resume, add to or swap another build's half-loaded staging
async function stagingOwnedBy(build) {
  const owners = await tableOwners(['pois_staging', 'poi_photos_staging'])
  return owners.pois_staging === build && owners.poi_photos_staging === build
}

const BUILD_ROW_SQL = 'SELECT status, chunks_total, chunks_loaded, manifest_sha256, coverage_sha256 FROM poi_builds WHERE build_id = ?'

async function ownedRow(build, statuses) {
  const row = await q1(BUILD_ROW_SQL, [build])
  if (!row || !statuses.includes(row.status)) throw new LoadError(409, `Build is ${row?.status || 'unknown'}; send step=begin first`)
  if (!(await stagingOwnedBy(build))) throw new LoadError(409, 'Staging holds another build; send step=begin first')
  return row
}

// ─── Steps ──────────────────────────────────────────────────────

async function begin(build) {
  const { manifest, digest } = await fetchManifest(build)
  const { value: coverage, digest: coverageDigest } = await fetchJson(build, 'coverage.json')
  if (!Array.isArray(coverage) || !coverage.every(c => isInt(c, 0, 1800 * 3600 - 1))) throw new LoadError(422, 'Bad coverage.json')
  const osmTimestamp = new Date(manifest.osm_timestamp).toISOString().slice(0, 19).replace('T', ' ')
  const total = manifest.chunks.length

  return withPoiLock(async () => {
    await recover()
    const existing = await q1(BUILD_ROW_SQL, [build])
    if (existing?.status === 'active') return { build, status: 'active', noop: true }
    // Same release revision only: a re-uploaded release starts again from chunk 0
    const resumable = ['loading', 'validating'].includes(existing?.status) &&
      existing.manifest_sha256 === digest && Number(existing.chunks_total) === total && await stagingOwnedBy(build)
    if (resumable) {
      await u("UPDATE poi_builds SET status = 'loading' WHERE build_id = ?", [build])
      return { build, status: 'loading', resumed: true, chunks_loaded: Number(existing.chunks_loaded), chunks_total: total }
    }
    // Staging belongs to whichever build began last; a fresh start takes it over
    await u(
      `UPDATE poi_builds SET status = 'failed', gate_report = ?
       WHERE status IN ('loading', 'validating') AND build_id <> ?`, [JSON.stringify({ abandoned_for: build }), build])
    await q('DROP TABLE IF EXISTS pois_staging, poi_photos_staging')
    await q('CREATE TABLE pois_staging LIKE pois')
    await q('CREATE TABLE poi_photos_staging LIKE poi_photos')
    await q('ALTER TABLE pois_staging COMMENT = ?', [build])
    await q('ALTER TABLE poi_photos_staging COMMENT = ?', [build])
    await q(
      `INSERT INTO poi_builds (build_id, release_tag, schema_version, osm_timestamp, chunks_total, chunks_loaded,
         coverage, manifest_sha256, coverage_sha256, status)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'loading') AS new
       ON DUPLICATE KEY UPDATE release_tag = new.release_tag, schema_version = new.schema_version,
         osm_timestamp = new.osm_timestamp, chunks_total = new.chunks_total, chunks_loaded = 0,
         coverage = new.coverage, manifest_sha256 = new.manifest_sha256, coverage_sha256 = new.coverage_sha256, status = 'loading', row_count = NULL, photo_count = NULL,
         gate_report = NULL, activated_at = NULL`,
      [build, `poi-${build}`, manifest.schema_version, osmTimestamp, total, JSON.stringify(coverage), digest, coverageDigest])
    return { build, status: 'loading', resumed: false, chunks_loaded: 0, chunks_total: total }
  })
}

async function chunk(build, i) {
  if (!Number.isInteger(i) || i < 0) throw new LoadError(400, 'Bad chunk index')
  return withPoiLock(async () => {
    const row = await ownedRow(build, ['loading'])
    const loaded = Number(row.chunks_loaded)
    if (i >= Number(row.chunks_total)) throw new LoadError(400, 'Chunk index past chunks_total')
    if (i > loaded) throw new LoadError(409, `Chunks load in order; next is ${loaded}`, { next: loaded })
    const manifest = await pinnedManifest(build, row)
    const meta = manifest.chunks[i]
    const gz = await fetchRelease(build, meta.name)
    if (createHash('sha256').update(gz).digest('hex') !== meta.sha256) throw new LoadError(422, `sha256 mismatch for ${meta.name}`)
    const rows = ndjson(gz).map(toPoiRow)
    if (rows.length !== meta.rows) throw new LoadError(422, `${meta.name} has ${rows.length} rows, manifest says ${meta.rows}`)
    await upsertBatches(INSERT_POIS, rows)
    await u('UPDATE poi_builds SET chunks_loaded = GREATEST(chunks_loaded, ?) WHERE build_id = ?', [i + 1, build])
    return { build, chunk: i, rows: rows.length, chunks_loaded: Math.max(loaded, i + 1), chunks_total: Number(row.chunks_total) }
  })
}

async function photos(build) {
  return withPoiLock(async () => {
    await pinnedManifest(build, await ownedRow(build, ['loading']))
    // Photos arrive in Phase 5; until then the file is simply absent
    const gz = await fetchRelease(build, 'photos.ndjson.gz', { optional: true })
    if (!gz) return { build, photos: 0, skipped: 'no photos.ndjson.gz in this release' }
    const rows = ndjson(gz).map(toPhotoRow)
    await upsertBatches(INSERT_PHOTOS, rows)
    return { build, photos: rows.length }
  })
}

// ─── Finalize gates ─────────────────────────────────────────────

async function loadPoiQuery() {
  try { return { mod: await import('../lib/poiQuery.js') } } catch (err) { return { error: err?.message || String(err) } }
}

export async function loadSentinels() {
  try {
    const list = JSON.parse(await readFile(join(process.cwd(), 'scripts', 'poi', 'sentinels.json'), 'utf8'))
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

const TYPE_CODES = { node: 1, way: 2, relation: 3, n: 1, w: 2, r: 3 }
function normaliseSentinel(s) {
  const t = s?.osm_type ?? s?.type
  const type = TYPE_CODES[t] || (TYPE_NAMES[t] ? t : null)
  const id = Number(s?.osm_id ?? s?.id)
  return type && Number.isSafeInteger(id) && typeof s.name === 'string' ? { type, id, name: s.name } : null
}

/**
 * Exact element count for a plan, from the translator's own SQL (buildSql) so
 * G6 judges the real WHERE. Unlimited groups get their scan cap lifted (a
 * capped count would make two big answers look equal); town groups keep their
 * `out ... N` limit, as served. The reader's MAX_EXECUTION_TIME hint is
 * dropped: this runs with its own timeout. Throws on DB error or timeout.
 */
export async function exactCount(buildSql, plan, table, deadline = Infinity) {
  const uncapped = { ...plan, groups: plan.groups.map(g => ({ ...g, limit: g.limit || 1e9 })) }
  const { sql, params } = buildSql(uncapped, table)
  // The reader's own hint is only legal on a top-level SELECT: ours goes on the outer one
  const inner = sql.replace(/\/\*\+[\s\S]*?\*\/\s*/g, '')
  const row = await gateOne(`SELECT COUNT(*) AS n FROM (${inner}) q`, params, { capMs: G6_QUERY_TIMEOUT_MS, deadline })
  return Number(row?.n)
}

const parseJson = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }

async function g6Samples() {
  const [{ townOverpassQuery }, { UK_TOWNS }, { buildDiscoverOverpassQuery }, { snapQueryBbox }] = await Promise.all([
    import('../lib/towns.js'), import('../../shared/ukTowns.mjs'),
    import('../../shared/overpassQuery.js'), import('../lib/bboxSnap.js'),
  ])
  const towns = G6_TOWNS.map(slug => UK_TOWNS.find(t => t.slug === slug)).filter(Boolean)
  return [
    ...towns.map(t => ({ label: `town:${t.slug}`, ql: townOverpassQuery(t.lat, t.lng) })),
    ...G6_DISCOVER.map(([name, lat, lng, r]) => ({
      label: `discover:${name}:${r / 1000}km`, ql: snapQueryBbox(buildDiscoverOverpassQuery(lat, lng, r, null).query),
    })),
  ]
}

/** Throws a retryable 503 when the DB is too slow to judge: slow is not a verdict. */
async function gateRealQueries(pq, hasActive, requestDeadline) {
  if (!pq.mod || typeof pq.mod.parseQuery !== 'function' || typeof pq.mod.buildSql !== 'function') {
    return { pass: false, detail: `api/lib/poiQuery.js unusable: ${pq.error || 'parseQuery/buildSql missing'}` }
  }
  const { parseQuery, buildSql } = pq.mod
  const failures = []
  const samples = await g6Samples()
  const deadline = Math.min(Date.now() + G6_BUDGET_MS, requestDeadline - SWAP_RESERVE_MS)
  const run = async (plan, table) => {
    if (Date.now() > deadline) throw retryLater('G6 inconclusive: query budget used up; re-send finalize')
    return exactCount(buildSql, plan, table, requestDeadline)
  }
  for (const { label, ql } of samples) {
    const plan = parseQuery(ql)
    if (!plan) { failures.push(`${label}: parseQuery returned null`); continue }
    const s = await run(plan, 'pois_staging')
    const a = hasActive ? await run(plan, 'pois') : null
    if (!(s > 0)) failures.push(`${label}: ${s} elements`)
    else if (a !== null && !(s >= QUERY_MIN * a)) failures.push(`${label}: ${s} vs active ${a}`)
  }
  return { pass: failures.length === 0, detail: { checked: samples.length, failures } }
}

export async function runGates(build, row, manifest, requestDeadline = Infinity) {
  const gates = []
  const gate = (id, name, pass, detail) => gates.push({ id, name, pass, detail })
  // The active build's figures were stored when it went live: no full scans of the live table
  const active = await q1(
    "SELECT build_id, row_count, photo_count, gate_report FROM poi_builds WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1")

  const pq = await loadPoiQuery()
  const expected = pq.mod?.POI_SCHEMA_VERSION
  gate('G1', 'schema', Number.isInteger(expected) && manifest.schema_version === expected,
    { manifest: manifest.schema_version, expected: expected ?? null, ...(pq.error ? { error: pq.error } : {}) })

  const scan = { capMs: GATE_SCAN_MS, deadline: requestDeadline }
  const gateCount = async table => Number((await gateOne(`SELECT COUNT(*) AS n FROM ${table}`, [], scan))?.n || 0)
  const stagingCount = await gateCount('pois_staging')
  gate('G2', 'completeness',
    Number(row.chunks_loaded) === Number(row.chunks_total) && stagingCount === manifest.row_count,
    { chunks_loaded: Number(row.chunks_loaded), chunks_total: Number(row.chunks_total), staging: stagingCount, manifest: manifest.row_count })

  const activeCount = active ? Number(active.row_count ?? await gateCount('pois')) : 0
  gate('G3', 'volume',
    !active ? stagingCount >= FIRST_BUILD_MIN_ROWS
      : stagingCount >= VOLUME_MIN * activeCount && stagingCount <= VOLUME_MAX * activeCount,
    { staging: stagingCount, active: active ? activeCount : null })

  // Every G4 key from staging in ONE scan (a SUM per key), checked against the manifest too
  const counts = manifest.per_key_counts || {}
  const sums = await gateOne(
    `SELECT ${MIX_KEYS.map((k, n) => `SUM(k_${k.split('=')[0]} = ?) AS m${n}`).join(', ')} FROM pois_staging`,
    MIX_KEYS.map(k => k.split('=')[1]), scan) || {}
  const s = Object.fromEntries(MIX_KEYS.map((k, n) => [k, Number(sums[`m${n}`] || 0)]))
  const unverified = MIX_KEYS.filter(k => s[k] !== Number(counts[k] || 0)).map(k => `${k}: manifest ${Number(counts[k] || 0)}, staging ${s[k]}`)
  const a = parseJson(active?.gate_report)?.per_key_counts
  if (unverified.length) gate('G4', 'mix', false, { unverified })
  else if (!active) gate('G4', 'mix', true, 'first build: nothing to compare')
  else if (!a) gate('G4', 'mix', null, 'skipped: the active build stored no per-key counts')
  else {
    const off = MIX_KEYS.filter(k => Math.abs(s[k] - Number(a[k] || 0)) > MIX_TOLERANCE * Number(a[k] || 0))
      .map(k => `${k}: ${s[k]} vs ${Number(a[k] || 0)}`)
    gate('G4', 'mix', off.length === 0, { off })
  }

  const sentinels = (await loadSentinels())?.map(normaliseSentinel).filter(Boolean)
  if (!sentinels?.length) gate('G5', 'sentinels', false, 'scripts/poi/sentinels.json missing or empty')
  else {
    const found = await gateQuery(
      `SELECT osm_type, osm_id, el FROM pois_staging WHERE (osm_type, osm_id) IN (${sentinels.map(() => '(?, ?)').join(', ')})`,
      sentinels.flatMap(x => [x.type, x.id]), scan)
    const names = new Map(found.map(r => {
      let tags = {}
      try { tags = JSON.parse(r.el).tags || {} } catch { /* counts as missing */ }
      return [`${Number(r.osm_type)}/${Number(r.osm_id)}`, [tags.name, tags['name:en']]]
    }))
    const missing = sentinels.filter(x => !names.get(`${x.type}/${x.id}`)?.includes(x.name)).map(x => `${TYPE_NAMES[x.type]}/${x.id} ${x.name}`)
    const ratio = (sentinels.length - missing.length) / sentinels.length
    gate('G5', 'sentinels', ratio >= SENTINEL_MIN, { found: sentinels.length - missing.length, total: sentinels.length, missing })
  }

  const g6 = await gateRealQueries(pq, Boolean(active), requestDeadline)
  gate('G6', 'real queries', g6.pass, g6.detail)

  const photoStaging = await gateCount('poi_photos_staging')
  const photoActive = active ? Number(active.photo_count ?? await gateCount('poi_photos')) : 0
  gate('G7', 'photos', photoActive === 0 || photoStaging >= PHOTO_MIN * photoActive, { staging: photoStaging, active: photoActive })

  // Every wide element must be in the LARGE bucket, or queries near its edges miss it (cheap: cell leads the PK)
  const largeStaging = Number((await gateOne('SELECT COUNT(*) AS n FROM pois_staging WHERE cell = ?', [largeCell()], scan))?.n || 0)
  gate('G8', 'large bucket', largeStaging === manifest.large_count, { staging: largeStaging, manifest: manifest.large_count })
  const warnings = largeStaging > LARGE_ALERT ? [`${largeStaging} rows in the LARGE bucket (alert above ${LARGE_ALERT}); every query scans them`] : []

  const failed = gates.filter(g => g.pass === false).map(g => g.id)
  return {
    build, gates, failed,
    passed: failed.length === 0, // skipped (null) never blocks
    required_failed: failed.filter(id => REQUIRED_GATES.includes(id)),
    row_count: stagingCount, photo_count: photoStaging,
    per_key_counts: s, large_count: largeStaging, warnings,
  }
}

/** The swap: nothing is dropped until the new build is live, so a failed RENAME leaves every rollback target. */
export function swapSql(prevTables) {
  const displaced = ['pois_prev', 'poi_photos_prev'].filter(t => prevTables.includes(t)).map(t => `${t} TO ${t.replace('_prev', '_old')}`)
  return [
    'DROP TABLE IF EXISTS pois_old, poi_photos_old', // leftovers of an earlier interrupted swap, never a rollback target
    `RENAME TABLE ${[...displaced, 'pois TO pois_prev', 'pois_staging TO pois', 'poi_photos TO poi_photos_prev', 'poi_photos_staging TO poi_photos'].join(', ')}`,
  ]
}

async function swap(conn, build) {
  const prevTables = Object.keys(await tableOwners(['pois_prev', 'poi_photos_prev']))
  // Set before the RENAME: if we die after it, recover() still invalidates caches
  await u('UPDATE poi_builds SET gen_pending = 1 WHERE build_id = ?', [build])
  try {
    for (const sql of swapSql(prevTables)) await conn.query(sql)
  } catch (err) {
    if (isLockWaitTimeout(err)) throw retryLater('Swap waited too long for readers; re-send finalize')
    throw err
  }
  // A crash between the RENAME and this UPDATE is repaired by reconcile()
  await u(
    `UPDATE poi_builds SET activated_at = IF(build_id = ?, NOW(), activated_at),
       status = IF(build_id = ?, 'active', 'previous')
     WHERE status = 'active' OR build_id = ?`, [build, build, build])
  await conn.query('DROP TABLE IF EXISTS pois_old, poi_photos_old')
    .catch(err => console.error('[poi-load] dropping the displaced previous build failed:', err?.message || err))
}

async function alertWarnings(build, report) {
  try {
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `[ROAM WARNING] POI build ${build} went live with warnings`,
      text: `The place database build ${build} passed its gates and is live, but:\n\n${report.warnings.join('\n')}`,
    })
  } catch (err) {
    console.error('[poi-load] warning email failed:', err?.message || err)
  }
}

async function alertFailure(build, report) {
  const lines = report.gates.map(g => `${g.pass === false ? 'FAIL' : g.pass === null ? 'SKIP' : 'OK  '} ${g.id} ${g.name}: ${JSON.stringify(g.detail).slice(0, 400)}`)
  try {
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `[ROAM ALERT] POI build ${build} failed its gates; live places unchanged`,
      text: `The nightly place database build ${build} was NOT swapped live.\n\n${lines.join('\n')}\n\n` +
        'The previous build keeps serving. Fix the build and re-run the workflow, or force it from an admin session ' +
        `(step=finalize&force=1) if the change is expected. ${REQUIRED_GATES.join(', ')} can never be forced.`,
    })
  } catch (err) {
    console.error('[poi-load] alert email failed:', err?.message || err)
  }
}

async function finalize(build, admin, deadline) {
  return withPoiLock(async conn => {
    await recover()
    const current = await q1('SELECT status FROM poi_builds WHERE build_id = ?', [build])
    if (current?.status === 'active') return { build, status: 'active', already: true }
    // A forced finalize may revive a build its gates failed (staging is kept)
    const row = await ownedRow(build, admin ? ['loading', 'validating', 'failed'] : ['loading', 'validating'])
    await u("UPDATE poi_builds SET status = 'validating' WHERE build_id = ?", [build])
    let report
    try {
      report = await runGates(build, row, await pinnedManifest(build, row), deadline)
    } catch (err) {
      // A hiccup (DB, GitHub, slow sample) is not a verdict: back to loading so finalize can be re-sent
      await u("UPDATE poi_builds SET status = 'loading' WHERE build_id = ?", [build]).catch(() => {})
      throw err
    }
    if (admin) report.forced_by = admin.user.id
    await u('UPDATE poi_builds SET gate_report = ?, row_count = ?, photo_count = ? WHERE build_id = ?',
      [JSON.stringify(report), report.row_count, report.photo_count, build])

    const blocked = report.required_failed.length > 0 || (!report.passed && !admin)
    await recordCronRun({
      jobName: JOB_NAME,
      eligibleCount: report.gates.length,
      sentCount: report.gates.length - report.failed.length,
      failedCount: report.failed.length,
      errorMessage: report.failed.length ? `${build}${admin ? ' (forced)' : ''}: ${report.failed.join(', ')}` : null,
    }).catch(err => console.error('[poi-load] recordCronRun failed:', err?.message || err))

    if (blocked) {
      await u("UPDATE poi_builds SET status = 'failed' WHERE build_id = ?", [build])
      await alertFailure(build, report)
      const msg = report.required_failed.length && admin
        ? `${report.required_failed.join(', ')} cannot be forced; live places unchanged`
        : 'Gates failed; live places unchanged'
      throw new LoadError(422, msg, { report })
    }
    // Gates passed; the swap itself is quick, but never start it at the edge of the budget
    if (Date.now() > deadline - SWAP_RESERVE_MS) throw retryLater('Not enough time left to swap safely; re-send finalize')
    await swap(conn, build)
    report.poi_gen = await flushPoiGen(`${build} going live`)
    if (report.warnings.length) await alertWarnings(build, report)
    return { build, status: 'active', forced: Boolean(admin), report }
  })
}

/**
 * Read-only. The live build comes from the `pois` COMMENT (RENAME carries it),
 * so it is right even if a crash left poi_builds stale.
 */
async function loaderStatus() {
  const owners = await tableOwners(['pois', 'pois_prev'])
  const live = BUILD_RE.test(owners.pois || '') ? owners.pois : null
  // The workflow's release prune protects both; pois_prev without a build COMMENT is the empty migration table
  const prevId = BUILD_RE.test(owners.pois_prev || '') ? owners.pois_prev : null
  const prevRow = prevId ? await q1('SELECT release_tag FROM poi_builds WHERE build_id = ?', [prevId]) : null
  const latest = await q1(
    'SELECT build_id, status, chunks_loaded, chunks_total, created_at FROM poi_builds ORDER BY created_at DESC LIMIT 1')
  return {
    active_build_id: live,
    active_release_tag: live ? `poi-${live}` : null,
    previous_release_tag: prevRow?.release_tag ?? null,
    latest: latest ? { build_id: latest.build_id, status: latest.status, chunks_loaded: Number(latest.chunks_loaded), chunks_total: Number(latest.chunks_total) } : null,
  }
}

// ─── Handler ────────────────────────────────────────────────────

async function handler(req, res) {
  const force = req.query?.force === '1'
  let admin = null
  // Force needs a real admin session even with the secret: a bot can't force
  if (force || !isAuthorizedLoader(req)) {
    admin = await guardAdmin(req, res, { key: 'admin-poi-load-ip' })
    if (!admin) return
  }
  if (req.method === 'GET' && req.query?.step === 'status') return res.status(200).json(await loaderStatus())
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const build = String(req.query?.build || '')
  if (!BUILD_RE.test(build)) return res.status(400).json({ error: 'Bad build id' })

  const deadline = Date.now() + REQUEST_BUDGET_MS
  try {
    const step = req.query?.step
    let out
    if (step === 'begin') out = await begin(build)
    else if (step === 'chunk') out = await chunk(build, /^\d{1,4}$/.test(req.query?.i) ? Number(req.query.i) : NaN)
    else if (step === 'photos') out = await photos(build)
    else if (step === 'finalize') out = await finalize(build, force ? admin : null, deadline)
    else return res.status(400).json({ error: 'step must be begin, chunk, photos or finalize' })
    return res.status(200).json(out)
  } catch (err) {
    if (err instanceof LoadError) {
      if (err.status === 503) res.setHeader('Retry-After', String(RETRY_AFTER_S))
      return res.status(err.status).json({ error: err.message, ...err.extra })
    }
    // Workflow logs are public: the detail stays in the function log
    const requestId = randomUUID()
    console.error(`[poi-load] ${requestId}`, err)
    return res.status(500).json({ error: 'Load failed', request_id: requestId })
  }
}

export default withCors(handler)
