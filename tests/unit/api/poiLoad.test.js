import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { db, kv, resetDb } from './poiFakeDb.js'

// api/admin/poi-load.js against the in-memory fake in poiFakeDb.js.

const getUserFromRequest = vi.fn()
const sendEmail = vi.fn(async () => ({ sent: true }))
const recordCronRun = vi.fn(async () => {})
const pq = {}
const cellPad = { value: 0.2 }

vi.mock('../../../api/lib/db.js', async () => (await import('./poiFakeDb.js')).dbModule)
vi.mock('../../../api/lib/kvCache.js', async () => (await import('./poiFakeDb.js')).kvModule)
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: (...a) => getUserFromRequest(...a) }))
vi.mock('../../../api/lib/email.js', () => ({ sendEmail: (...a) => sendEmail(...a) }))
vi.mock('../../../api/lib/cronRuns.js', () => ({ recordCronRun: (...a) => recordCronRun(...a) }))
vi.mock('../../../api/lib/poiQuery.js', () => ({
  get parseQuery() { return pq.parseQuery },
  get buildSql() { return pq.buildSql },
  get POI_SCHEMA_VERSION() { return pq.POI_SCHEMA_VERSION },
}))
vi.mock('../../../shared/poiCell.mjs', async orig => ({
  ...(await orig()),
  get CELL_PAD_DEG() { return cellPad.value },
  isLarge: b => Math.max(b.max_lat - b.min_lat, b.max_lon - b.min_lon) / 2 > cellPad.value,
}))

const { poiCell } = await import('../../../shared/poiCell.mjs')
const mod = await import('../../../api/admin/poi-load.js')
const handler = mod.default
const { RELEASE_BASE, releaseUrl, INSERT_POIS, POI_COLS, MAX_DOWNLOAD_BYTES, toPoiRow } = mod

const ROOT = process.cwd() // captured before any test repoints cwd
// The loader reads <cwd>/scripts/poi/sentinels.json; tests point cwd at a temp dir
const tmp = mkdtempSync(join(tmpdir(), 'poi-load-'))
mkdirSync(join(tmp, 'scripts', 'poi'), { recursive: true })
const sentinelsPath = join(tmp, 'scripts', 'poi', 'sentinels.json')
const writeSentinels = list => writeFileSync(sentinelsPath, JSON.stringify(list))

// ─── Release fixtures ───────────────────────────────────────────

const BUILD = 'uk-20261001T0215Z'
const ACTIVE = 'uk-20260930T0215Z'
const OLDER = 'uk-20260929T0215Z'
const SECRET = 'test-poi-secret-0123456789'
const base = `${RELEASE_BASE}poi-${BUILD}/`

function poi(id, name, lat = 51.5 + id / 1000, lon = -0.12) {
  const el = JSON.stringify({ type: 'node', id, lat, lon, tags: { name, amenity: 'cafe' } })
  return { cell: poiCell(lat, lon), osm_type: 1, osm_id: id, lat, lon, min_lat: lat, min_lon: lon, max_lat: lat, max_lon: lon,
    k_amenity: 'cafe', k_tourism: null, k_leisure: null, k_historic: null, k_shop: null, k_natural: null, k_man_made: null,
    has_name: 1, has_name_tag: 1, has_wikidata: 0, el }
}
// A way whose bounds are wider than its centre, as the build emits them
function park(id, name) {
  const [lat, lon] = [51.6, -0.2]
  const bounds = { minlat: 51.55, minlon: -0.3, maxlat: 51.65, maxlon: -0.1 }
  const el = JSON.stringify({ type: 'way', id, center: { lat, lon }, bounds, tags: { 'name:en': name, leisure: 'park' } })
  return { ...poi(0, ''), cell: poiCell(lat, lon), osm_type: 2, osm_id: id, lat, lon,
    min_lat: 51.55, min_lon: -0.3, max_lat: 51.65, max_lon: -0.1, k_amenity: null, k_leisure: 'park', has_name_tag: 0, el }
}
// Wider than 2 x CELL_PAD_DEG: lives in the LARGE bucket (cell 0)
function channel(id, name) {
  const [lat, lon] = [51.3, -3.8]
  const el = JSON.stringify({ type: 'relation', id, center: { lat, lon }, bounds: { minlat: 51, minlon: -5, maxlat: 51.6, maxlon: -2.6 },
    tags: { name, natural: 'water' } })
  return { ...poi(0, ''), cell: 0, osm_type: 3, osm_id: id, lat, lon, min_lat: 51, min_lon: -5, max_lat: 51.6, max_lon: -2.6,
    k_amenity: null, k_natural: 'water', el }
}
const gz = rows => gzipSync(rows.map(r => JSON.stringify(r)).join('\n') + '\n')
const sha = buf => createHash('sha256').update(buf).digest('hex')

let files, fetchMock
function release(chunks, manifestPatch = {}) {
  files = new Map()
  const metas = chunks.map((rows, i) => {
    const buf = gz(rows)
    const name = `chunk-${String(i).padStart(3, '0')}.ndjson.gz`
    files.set(name, buf)
    return { name, sha256: sha(buf), rows: rows.length }
  })
  const manifest = {
    build_id: BUILD, schema_version: 1, osm_timestamp: '2026-10-01T02:15:00Z', chunks: metas,
    row_count: metas.reduce((n, c) => n + c.rows, 0), per_key_counts: { 'amenity=cafe': 3, 'leisure=park': 1 },
    photo_count: 0, large_count: 1, ...manifestPatch,
  }
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
  files.set('coverage.json', Buffer.from(JSON.stringify([poiCell(51.5, -0.12)])))
  return manifest
}
const CHUNKS = [[poi(1, 'British Museum'), poi(2, 'Cafe Two')], [poi(3, 'Cafe Three'), park(4, 'Big Park'), channel(5, 'Bristol Channel')]]

// ─── HTTP helpers ───────────────────────────────────────────────

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined }
  res.status = c => { res.statusCode = c; return res }
  res.json = b => { res.body = b; return res }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.end = () => res
  return res
}
let ip = 0
async function call(q, { auth = `Bearer ${SECRET}`, origin, method = 'POST' } = {}) {
  const headers = { 'x-forwarded-for': `10.9.${Math.floor(ip / 250)}.${ip++ % 250}` }
  if (auth) headers.authorization = auth
  if (origin) headers.origin = origin
  const res = mockRes()
  await handler({ method, headers, query: { build: BUILD, ...q }, body: {} }, res)
  return res
}
const admin = { auth: 'Bearer admin-jwt', origin: 'https://go-roam.uk' }
const load = async (chunks = CHUNKS.length) => {
  expect((await call({ step: 'begin' })).statusCode).toBe(200)
  for (let i = 0; i < chunks; i++) expect((await call({ step: 'chunk', i: String(i) })).statusCode).toBe(200)
}
const statusOf = id => db.builds.get(id)?.status

// A live build the new one matches exactly, with its figures stored at activation
function withActive({ prev = false } = {}) {
  db.builds.set(ACTIVE, { status: 'active', chunks_total: 2, chunks_loaded: 2, row_count: 5, photo_count: 0,
    gate_report: { per_key_counts: { 'amenity=cafe': 3, 'leisure=park': 1 } } })
  db.tables.pois.comment = ACTIVE
  if (prev) {
    db.builds.set(OLDER, { status: 'previous', chunks_total: 2, chunks_loaded: 2 })
    db.tables.pois_prev = db.newTable(OLDER)
    db.tables.poi_photos_prev = db.newTable(OLDER)
  }
}

beforeEach(() => {
  resetDb()
  process.env.POI_LOAD_SECRET = SECRET
  release(CHUNKS)
  fetchMock = vi.fn(async url => {
    const name = String(url).startsWith(base) ? String(url).slice(base.length) : null
    const buf = name && files.get(name)
    if (buf instanceof Response) return buf
    return buf ? new Response(buf, { status: 200 }) : new Response('nope', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  getUserFromRequest.mockReset().mockResolvedValue(null)
  sendEmail.mockClear(); recordCronRun.mockClear()
  writeSentinels([{ type: 'node', id: 1, name: 'British Museum' }, { type: 'way', id: 4, name: 'Big Park' }])
  vi.spyOn(process, 'cwd').mockReturnValue(tmp)
  Object.assign(pq, {
    POI_SCHEMA_VERSION: 1,
    parseQuery: ql => ({ kind: 'area', ql, groups: [{ limit: null }] }),
    buildSql: (plan, table) => ({ sql: `(SELECT /*+ MAX_EXECUTION_TIME(800) */ 0 AS g FROM ${table} LIMIT ?)`, params: plan.groups.map(g => g.limit) }),
  })
  cellPad.value = 0.2
})
afterEach(() => {
  // Every request released the lock and closed its dedicated connection
  expect(db.lockHeld === null || db.lockHeld === 'other').toBe(true)
  expect(db.closed).toBe(db.opened)
  vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.POI_LOAD_SECRET
})

// ─── Auth ───────────────────────────────────────────────────────

describe('auth', () => {
  it('404s with no auth, a wrong secret, or an unset secret, and never touches the DB', async () => {
    expect((await call({ step: 'begin' }, { auth: null })).statusCode).toBe(404)
    expect((await call({ step: 'begin' }, { auth: 'Bearer nope' })).statusCode).toBe(404)
    delete process.env.POI_LOAD_SECRET
    expect((await call({ step: 'begin' })).statusCode).toBe(404)
    expect(db.log).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the secret (no admin session needed) and an admin session from our origin', async () => {
    expect((await call({ step: 'begin' })).statusCode).toBe(200)
    getUserFromRequest.mockResolvedValue({ id: 1, is_admin: true })
    expect((await call({ step: 'begin' }, admin)).statusCode).toBe(200)
  })

  it('GET step=status: needs auth, and names the live build from the table itself', async () => {
    expect((await call({ step: 'status', build: undefined }, { auth: null, method: 'GET' })).statusCode).toBe(404)
    let res = await call({ step: 'status', build: undefined }, { method: 'GET' })
    expect(res.body).toEqual({ active_build_id: null, active_release_tag: null, previous_release_tag: null, latest: null })
    withActive({ prev: true })
    db.builds.set(BUILD, { status: 'loading', chunks_total: 2, chunks_loaded: 1 })
    db.builds.get(ACTIVE).status = 'validating' // stale after a crash: the COMMENT still wins
    res = await call({ step: 'status', build: undefined }, { method: 'GET' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ active_build_id: ACTIVE, active_release_tag: `poi-${ACTIVE}`, previous_release_tag: `poi-${OLDER}`,
      latest: { build_id: BUILD, status: 'loading', chunks_loaded: 1, chunks_total: 2 } })
    expect(db.log.some(s => /^(UPDATE|INSERT|DROP|RENAME)/.test(s))).toBe(false)
    getUserFromRequest.mockResolvedValue({ id: 1, is_admin: true })
    expect((await call({ step: 'status' }, { ...admin, method: 'GET' })).statusCode).toBe(200)
  })

  it('rejects a bad build id before any fetch', async () => {
    for (const build of ['uk-2026', '../../evil', 'UK-20261001T0215Z', 'uk-20261001T0215Z/../x', '']) {
      expect((await call({ step: 'begin', build })).statusCode).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a 500 never echoes internals, only a request id', async () => {
    await load()
    db.fail.push({ re: /FROM poi_photos_staging$/, err: new Error('connect ECONNREFUSED secret-db.rds.amazonaws.com') })
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Load failed', request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(JSON.stringify(res.body)).not.toMatch(/rds|ECONN/)
    expect(statusOf(BUILD)).toBe('loading') // a hiccup is not a verdict
  })
})

// ─── Downloads ──────────────────────────────────────────────────

describe('downloads', () => {
  it('every fetched URL is RELEASE_BASE/poi-<build>/<known file>', async () => {
    withActive()
    await load()
    await call({ step: 'photos' })
    await call({ step: 'finalize' })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(4)
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toMatch(/^https:\/\/github\.com\/crayolaconsumer\/weekend-adventure-planner\/releases\/download\/poi-uk-20261001T0215Z\/(manifest\.json|coverage\.json|photos\.ndjson\.gz|chunk-\d{3}\.ndjson\.gz)$/)
    }
  })

  it('releaseUrl refuses any other file name', () => {
    for (const f of ['https://evil.example/x', '../x', 'chunk-1.ndjson.gz', 'chunk-000.ndjson.gz?x', '/etc/passwd']) {
      expect(() => releaseUrl(BUILD, f)).toThrow(/Refusing/)
    }
    expect(() => releaseUrl('evil.example', 'manifest.json')).toThrow(/Bad build id/)
  })

  it('a manifest naming a foreign chunk is refused before any chunk fetch', async () => {
    const m = release(CHUNKS)
    m.chunks[0].name = 'https://evil.example/chunk-000.ndjson.gz'
    files.set('manifest.json', Buffer.from(JSON.stringify(m)))
    const res = await call({ step: 'begin' })
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/chunk 0 name/)
    expect(fetchMock.mock.calls.every(([u]) => u.endsWith('manifest.json'))).toBe(true)
  })

  // Finite (40 MB) so a broken cap fails the test rather than hanging it
  const stream = state => new ReadableStream({
    pull(c) { if (++state.pulls > 40) c.close(); else c.enqueue(new Uint8Array(1024 * 1024)) },
    cancel() { state.cancelled = true },
  }, { highWaterMark: 0 })

  it('an oversized content-length is refused without reading the body', async () => {
    const state = { pulls: 0 }
    files.set('manifest.json', new Response(stream(state), { headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) } }))
    const res = await call({ step: 'begin' })
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/too large/)
    expect(state.pulls).toBe(0)
  })

  it('a body over 32 MB with no content-length is cut off mid-stream', async () => {
    const state = { pulls: 0, cancelled: false }
    files.set('manifest.json', new Response(stream(state)))
    const res = await call({ step: 'begin' })
    expect(res.statusCode).toBe(422)
    expect(state.pulls).toBeLessThanOrEqual(34)
    expect(state.cancelled).toBe(true)
  })
})

// ─── Row validation ─────────────────────────────────────────────

describe('toPoiRow', () => {
  const ok = poi(1, 'A')
  it('accepts a node and a way with real bounds, in POI_COLS order', () => {
    expect(toPoiRow(ok)).toHaveLength(POI_COLS.length)
    expect(toPoiRow(park(4, 'P'))[POI_COLS.indexOf('min_lon')]).toBe(-0.3)
  })
  it.each([
    ['min > max', { min_lat: 52, max_lat: 51 }, /bounds/],
    ['centre outside bounds', { min_lat: 51.6, max_lat: 51.7 }, /bounds/],
    ['missing bounds', { max_lon: undefined }, /bounds/],
    ['has_name_tag lies', { has_name_tag: 0 }, /has_name_tag/],
    ['has_name lies', { has_name: 0 }, /has_name disagrees/],
    ['bad flag', { has_name_tag: 2 }, /flags/],
  ])('rejects %s', (_label, patch, re) => {
    expect(() => toPoiRow({ ...ok, ...patch })).toThrow(re)
  })
  it('a wide element must be in the LARGE cell, and only a wide one may be', () => {
    expect(toPoiRow(channel(5, 'C'))[0]).toBe(0)
    const c = channel(5, 'C')
    expect(() => toPoiRow({ ...c, cell: poiCell(c.lat, c.lon) })).toThrow(/LARGE/)
    expect(() => toPoiRow({ ...ok, cell: 0 })).toThrow(/poiCell/)
  })
  it('measures el in bytes, not characters', () => {
    const name = '€'.repeat(22000) // 22,000 characters, 66,000 bytes
    const el = JSON.stringify({ type: 'node', id: 1, lat: ok.lat, lon: ok.lon, tags: { name } })
    expect(el.length).toBeLessThan(65535)
    expect(() => toPoiRow({ ...ok, el })).toThrow(/el/)
  })
})

// ─── Loading ────────────────────────────────────────────────────

describe('loading', () => {
  it('begin creates owned staging tables and a loading row', async () => {
    const res = await call({ step: 'begin' })
    expect(res.body).toMatchObject({ resumed: false, chunks_loaded: 0, chunks_total: 2 })
    expect(db.tables.pois_staging.comment).toBe(BUILD)
    expect(db.tables.poi_photos_staging.comment).toBe(BUILD)
    expect(db.builds.get(BUILD)).toMatchObject({ status: 'loading', chunks_total: 2 })
  })

  it('every step takes the global lock on a dedicated connection', async () => {
    await load()
    await call({ step: 'photos' })
    expect(db.log.filter(s => s === 'SELECT GET_LOCK(?, 0) AS got')).toHaveLength(4)
    expect(db.log).toContain('SET SESSION wait_timeout = 150, lock_wait_timeout = 5')
  })

  it('a busy lock is a retryable 409 and nothing is written', async () => {
    await call({ step: 'begin' })
    db.lockHeld = 'other'
    for (const q of [{ step: 'begin' }, { step: 'chunk', i: '0' }, { step: 'photos' }, { step: 'finalize' }]) {
      const res = await call(q)
      expect(res.statusCode).toBe(409)
      expect(res.body.retry).toBe(true)
    }
    expect(db.tables.pois_staging.rows.size).toBe(0)
    expect(db.lockHeld).toBe('other') // the loser never releases someone else's lock
  })

  it('a missing large_count in the manifest is refused at begin', async () => {
    release(CHUNKS, { large_count: undefined })
    expect((await call({ step: 'begin' })).body.error).toMatch(/large_count/)
  })

  it('begin on the active build is a no-op', async () => {
    db.builds.set(BUILD, { status: 'active', chunks_total: 2, chunks_loaded: 2 })
    expect((await call({ step: 'begin' })).body).toMatchObject({ noop: true })
    expect(db.log.some(s => s.startsWith('DROP'))).toBe(false)
  })

  it('upserts in 1,000-row multi-VALUES statements', async () => {
    release([Array.from({ length: 2500 }, (_, n) => poi(n + 1, `P${n}`, 51 + n / 100000))])
    await load(1)
    const inserts = db.log.filter(s => s.startsWith('INSERT INTO pois_staging'))
    expect(inserts).toHaveLength(3)
    expect(db.tables.pois_staging.rows.size).toBe(2500)
    expect(INSERT_POIS).toMatch(/VALUES \? AS new ON DUPLICATE KEY UPDATE lat = new\.lat/)
  })

  it('re-sending a chunk is idempotent', async () => {
    await load()
    expect((await call({ step: 'chunk', i: '0' })).statusCode).toBe(200)
    expect(db.tables.pois_staging.rows.size).toBe(5)
    expect(db.builds.get(BUILD).chunks_loaded).toBe(2)
  })

  it('refuses chunks out of order, so chunks_loaded is a true resume point', async () => {
    await call({ step: 'begin' })
    const res = await call({ step: 'chunk', i: '1' })
    expect(res.statusCode).toBe(409)
    expect(res.body.next).toBe(0)
    expect(db.tables.pois_staging.rows.size).toBe(0)
    for (const i of ['-1', '', 'x', '2']) expect([400, 409]).toContain((await call({ step: 'chunk', i })).statusCode)
  })

  it('a sha256 mismatch is rejected and nothing is written', async () => {
    await call({ step: 'begin' })
    files.set('chunk-000.ndjson.gz', gz([poi(9, 'Tampered')]))
    const res = await call({ step: 'chunk', i: '0' })
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/sha256 mismatch/)
    expect(db.tables.pois_staging.rows.size).toBe(0)
    expect(db.builds.get(BUILD).chunks_loaded).toBe(0)
  })

  it('a row whose cell disagrees with poiCell is rejected', async () => {
    release([[{ ...poi(1, 'X'), cell: 1 }]])
    await call({ step: 'begin' })
    expect((await call({ step: 'chunk', i: '0' })).body.error).toMatch(/cell/)
  })

  it('begin resumes from chunks_loaded without dropping staging', async () => {
    await call({ step: 'begin' })
    await call({ step: 'chunk', i: '0' })
    db.log.length = 0
    expect((await call({ step: 'begin' })).body).toMatchObject({ resumed: true, chunks_loaded: 1, chunks_total: 2 })
    expect(db.log.some(s => s.startsWith('DROP'))).toBe(false)
    expect(db.tables.pois_staging.rows.size).toBe(2)
  })

  it('never resumes onto or adds to staging another build took over', async () => {
    await call({ step: 'begin' })
    await call({ step: 'chunk', i: '0' })
    db.tables.pois_staging.comment = 'uk-20261002T0215Z'
    expect((await call({ step: 'chunk', i: '1' })).statusCode).toBe(409)
    expect((await call({ step: 'begin' })).body.resumed).toBe(false)
    expect(db.tables.pois_staging.rows.size).toBe(0)
  })

  it('a re-uploaded release is refused by chunk, photos and finalize (never mixes revisions)', async () => {
    await call({ step: 'begin' })
    await call({ step: 'chunk', i: '0' })
    expect(db.builds.get(BUILD).manifest_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(db.builds.get(BUILD).coverage_sha256).toMatch(/^[0-9a-f]{64}$/)
    release(CHUNKS, { photo_count: 1 }) // same chunks, different manifest bytes
    for (const q of [{ step: 'chunk', i: '1' }, { step: 'photos' }, { step: 'finalize' }]) {
      const res = await call(q)
      expect(res.statusCode).toBe(409)
      expect(res.body.error).toMatch(/manifest changed/)
    }
    expect(db.tables.pois_staging.rows.size).toBe(2)
  })

  it('a re-uploaded coverage.json is refused too', async () => {
    await call({ step: 'begin' })
    await call({ step: 'chunk', i: '0' })
    files.set('coverage.json', Buffer.from(JSON.stringify([poiCell(51.5, -0.12), poiCell(52, 0)])))
    for (const q of [{ step: 'chunk', i: '1' }, { step: 'photos' }, { step: 'finalize' }]) {
      const res = await call(q)
      expect(res.statusCode).toBe(409)
      expect(res.body.error).toMatch(/coverage changed/)
    }
  })

  it('begin after a re-upload starts again instead of resuming', async () => {
    await call({ step: 'begin' })
    await call({ step: 'chunk', i: '0' })
    release(CHUNKS, { photo_count: 1 })
    expect((await call({ step: 'begin' })).body).toMatchObject({ resumed: false, chunks_loaded: 0 })
    expect(db.tables.pois_staging.rows.size).toBe(0)
  })

  it('every statement of a locked step runs on the locked connection, none through the pool', async () => {
    withActive()
    await load()
    await call({ step: 'photos' })
    await call({ step: 'finalize' })
    expect(db.poolCalls).toBe(0)
    expect(db.connLog.length).toBeGreaterThan(20)
  })

  it('if the locked session dies mid-step, nothing is written through another connection', async () => {
    await call({ step: 'begin' })
    db.log.length = 0
    db.connDies = true
    const res = await call({ step: 'chunk', i: '0' })
    expect(res.statusCode).toBe(500)
    expect(db.log.some(s => s.startsWith('INSERT'))).toBe(false)
    expect(db.poolCalls).toBe(0)
  })

  it('a fresh begin marks an abandoned loading build failed', async () => {
    db.builds.set(OLDER, { status: 'loading', chunks_total: 3, chunks_loaded: 1 })
    await call({ step: 'begin' })
    expect(statusOf(OLDER)).toBe('failed')
  })

  it('photos: loads the file when present and skips cleanly when absent', async () => {
    await load()
    expect((await call({ step: 'photos' })).body.skipped).toMatch(/no photos/)
    const photo = { photo_key: 'Q42', url: 'https://commons.wikimedia.org/x.jpg', width: 800, height: 600, source: 'wikidata',
      artist: 'A'.repeat(300), license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      page_url: 'https://commons.wikimedia.org/wiki/File:X.jpg', checked_on: '2026-10-01' }
    files.set('photos.ndjson.gz', gz([photo]))
    expect((await call({ step: 'photos' })).body.photos).toBe(1)
    expect(db.tables.poi_photos_staging.rows.get('Q42').artist).toHaveLength(255)
  })
})

// ─── Finalize, gates, swap ──────────────────────────────────────

const ALL_PASS = [['G1', true], ['G2', true], ['G3', true], ['G4', true], ['G5', true], ['G6', true], ['G7', true], ['G8', true]]

describe('finalize', () => {
  it('passes every gate and swaps without dropping anything first', async () => {
    withActive({ prev: true })
    await load()
    db.log.length = 0
    db.connLog.length = 0
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(200)
    expect(res.body.report.gates.map(g => [g.id, g.pass])).toEqual(ALL_PASS)
    expect(db.log.filter(s => /^(DROP|RENAME)|status = IF/.test(s))).toEqual([
      'DROP TABLE IF EXISTS pois_old, poi_photos_old',
      'RENAME TABLE pois_prev TO pois_old, poi_photos_prev TO poi_photos_old, pois TO pois_prev, pois_staging TO pois, poi_photos TO poi_photos_prev, poi_photos_staging TO poi_photos',
      expect.stringMatching(/status = IF\(build_id = \?, 'active', 'previous'\)/),
      'DROP TABLE IF EXISTS pois_old, poi_photos_old',
    ])
    // gate_report (with the per-key counts the next build compares against) is stored before the swap
    expect(db.log.findIndex(s => s.includes('SET gate_report'))).toBeLessThan(db.log.findIndex(s => s.startsWith('RENAME')))
    expect(db.builds.get(BUILD).gate_report.per_key_counts['amenity=cafe']).toBe(3)
    expect(db.tables.pois.comment).toBe(BUILD)
    expect(db.tables.pois_prev.comment).toBe(ACTIVE)
    expect(db.tables.pois_old).toBeUndefined()
    // swap DDL runs on the locked connection, the one with lock_wait_timeout set
    expect(db.connLog.filter(s => /^(DROP|RENAME)/.test(s))).toHaveLength(3)
    expect(db.tables.pois_staging).toBeUndefined()
    expect([statusOf(BUILD), statusOf(ACTIVE)]).toEqual(['active', 'previous'])
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordCronRun).toHaveBeenCalledWith(expect.objectContaining({ jobName: 'poi-load', failedCount: 0 }))
  })

  it('a swap INCRs roam:poiGen and never touches roam:flags', async () => {
    kv.gen = 7
    withActive()
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.body.report.poi_gen).toBe(8)
    expect(kv.incrs).toEqual(['roam:poiGen'])
    expect(kv.writes).toEqual([])
    expect(db.builds.get(BUILD).gen_pending).toBe(0)
    // pending is set BEFORE the RENAME
    expect(db.log.findIndex(s => s.includes('gen_pending = 1 WHERE build_id'))).toBeLessThan(db.log.findIndex(s => s.startsWith('RENAME')))
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a failed INCR leaves gen_pending; the swap stands, James is emailed, the next call retries', async () => {
    kv.incrError = new Error('upstash down')
    withActive()
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(200)
    expect(res.body.report.poi_gen).toBeNull()
    expect(statusOf(BUILD)).toBe('active')
    expect(db.builds.get(BUILD).gen_pending).toBe(1)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/generation not bumped/) }))
    kv.incrError = null
    // the idempotent re-sent finalize retries it
    expect((await call({ step: 'finalize' })).body).toMatchObject({ already: true })
    expect(kv.incrs).toEqual(['roam:poiGen'])
    expect(db.builds.get(BUILD).gen_pending).toBe(0)
  })

  it('a crash after the RENAME still invalidates: the next begin INCRs', async () => {
    withActive()
    await load()
    db.fail.push({ re: /status = IF\(build_id = \?, 'active', 'previous'\)/, once: true, err: new Error('connection lost') })
    expect((await call({ step: 'finalize' })).statusCode).toBe(500)
    expect(kv.incrs).toEqual([])
    await call({ step: 'begin' })
    expect(kv.incrs).toEqual(['roam:poiGen'])
    expect(db.builds.get(BUILD).gen_pending).toBe(0)
  })

  it('failed gates do not bump poiGen', async () => {
    withActive()
    await load()
    db.builds.get(ACTIVE).row_count = 100
    expect((await call({ step: 'finalize' })).statusCode).toBe(422)
    expect(kv.incrs).toEqual([])
  })

  it('reads the live build figures from poi_builds, never scanning the live tables', async () => {
    withActive()
    await load()
    db.log.length = 0
    await call({ step: 'finalize' })
    expect(db.log.filter(s => /FROM (pois|poi_photos)$/.test(s))).toEqual([])
  })

  it('the very first swap has no previous build to displace', async () => {
    await load()
    cellPad.value = 1
    getUserFromRequest.mockResolvedValue({ id: 7, is_admin: true }) // G3's 150k floor needs a force
    const res = await call({ step: 'finalize', force: '1' }, admin)
    expect(res.statusCode).toBe(200)
    expect(db.log).toContain('RENAME TABLE pois TO pois_prev, pois_staging TO pois, poi_photos TO poi_photos_prev, poi_photos_staging TO poi_photos')
  })

  const cases = {
    G1: () => { pq.POI_SCHEMA_VERSION = 2 },
    G2: () => { db.tables.pois_staging.rows.delete('1/3') },
    G3: () => { db.builds.get(ACTIVE).row_count = 100 },
    G4: () => { db.builds.get(ACTIVE).gate_report.per_key_counts['amenity=cafe'] = 10 },
    G5: () => { writeSentinels([{ type: 'node', id: 1, name: 'Not The Museum' }]) },
    G6: () => { db.g6Count = inner => (inner.includes('pois_staging') ? 8 : 10) },
    G7: () => { db.builds.get(ACTIVE).photo_count = 100 },
    G8: () => { db.tables.pois_staging.rows.delete('3/5'); db.tables.pois_staging.count = 5 },
  }
  it.each(Object.keys(cases))('%s failing blocks the swap, writes gate_report, emails, records the run', async id => {
    withActive({ prev: true })
    await load()
    cases[id]()
    db.log.length = 0
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(422)
    const failed = res.body.report.gates.filter(g => g.pass === false).map(g => g.id)
    expect(failed).toContain(id)
    if (id !== 'G2') expect(failed).toEqual([id]) // G2's missing row also moves G3 and G4's sample
    expect(db.log.some(s => /^(RENAME|DROP)/.test(s))).toBe(false)
    expect(statusOf(BUILD)).toBe('failed')
    expect(db.builds.get(BUILD).gate_report.gates.find(g => g.id === id).pass).toBe(false)
    expect(statusOf(ACTIVE)).toBe('active')
    expect(db.tables.pois_prev.comment).toBe(OLDER)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/POI build .* failed/) }))
    expect(recordCronRun).toHaveBeenCalledWith(expect.objectContaining({ jobName: 'poi-load', failedCount: failed.length }))
  })

  it.each(['G1', 'G2', 'G8'])('%s cannot be forced, even by an admin', async id => {
    withActive()
    await load()
    cases[id]()
    getUserFromRequest.mockResolvedValue({ id: 7, is_admin: true })
    const res = await call({ step: 'finalize', force: '1' }, admin)
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toMatch(/cannot be forced/)
    expect(res.body.report.required_failed).toContain(id)
    expect(db.tables.pois.comment).toBe(ACTIVE)
  })

  it('over 1,000 LARGE rows still goes live, with a warning email', async () => {
    release(CHUNKS, { large_count: 1001 })
    withActive()
    await load()
    db.tables.pois_staging.largeCount = 1001
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(200)
    expect(res.body.report.warnings).toEqual([expect.stringMatching(/1001 rows in the LARGE bucket/)])
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/WARNING/) }))
  })

  it('G4 fails when the manifest per-key counts disagree with staging', async () => {
    release(CHUNKS, { per_key_counts: { 'amenity=cafe': 5, 'leisure=park': 1 } })
    withActive()
    db.builds.get(ACTIVE).gate_report.per_key_counts['amenity=cafe'] = 5
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.body.report.gates.find(g => g.id === 'G4')).toMatchObject({ pass: false, detail: { unverified: [expect.stringMatching(/amenity=cafe/)] } })
  })

  it('first build: G3 needs 150k rows, G4 has nothing to compare', async () => {
    await load()
    const g = Object.fromEntries((await call({ step: 'finalize' })).body.report.gates.map(x => [x.id, x.pass]))
    expect(g).toMatchObject({ G3: false, G4: true, G6: true, G7: true })
  })

  it('G5 fails closed when sentinels.json is missing', async () => {
    rmSync(sentinelsPath)
    withActive()
    await load()
    expect((await call({ step: 'finalize' })).body.report.gates.find(g => g.id === 'G5').pass).toBe(false)
  })

  it('an unusable poiQuery.js fails G1 and G6 (no fallback, no skip)', async () => {
    Object.assign(pq, { POI_SCHEMA_VERSION: undefined, parseQuery: undefined, buildSql: undefined })
    withActive()
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(422)
    expect(res.body.report.failed).toEqual(['G1', 'G6'])
  })

  it('G6 counts exactly with the translator SQL: 30 samples x 2 tables, cap lifted, 5 s timeout, no reader hint', async () => {
    const seen = []
    pq.parseQuery = ql => ({ kind: 'area', ql, groups: [{ limit: null }, { limit: 150 }] })
    const real = pq.buildSql
    pq.buildSql = (plan, table) => { seen.push({ table, limits: plan.groups.map(g => g.limit) }); return real(plan, table) }
    withActive()
    await load()
    db.timeouts.length = 0
    db.log.length = 0
    await call({ step: 'finalize' })
    expect(seen.filter(o => o.table === 'pois_staging')).toHaveLength(30)
    expect(seen.filter(o => o.table === 'pois')).toHaveLength(30)
    expect(seen.every(o => o.limits[0] === 1e9 && o.limits[1] === 150)).toBe(true) // town caps kept, scan cap lifted
    const counts = db.log.filter(s => s.includes('COUNT(*) AS n FROM ((SELECT'))
    expect(counts).toHaveLength(60)
    // our server limit on the OUTER select (5 s cap); the reader's inner hint removed
    for (const c of counts) expect(c).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\/ COUNT\(\*\) AS n FROM \(\(SELECT 0 AS g/)
    expect(counts.every(c => c.match(/MAX_EXECUTION_TIME/g).length === 1)).toBe(true)
  })

  it('two big answers are compared exactly, never as capped-equal', async () => {
    db.g6Count = inner => (inner.includes('pois_staging') ? 20000 : 30000) // both over SCAN_ROWS
    withActive()
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(422)
    expect(res.body.report.failed).toEqual(['G6'])
  })

  it('every validation query carries a server-side limit sized to the time left', async () => {
    let clock = 1e12
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    db.onSql = s => { if (s === 'SELECT COUNT(*) AS n FROM pois_staging') clock += 70000 } // 70 s gone after G2
    withActive()
    await load()
    db.log.length = 0
    db.execLimits.length = 0
    await call({ step: 'finalize' })
    const gateSql = db.log.filter(s => s.startsWith('SELECT') && /FROM pois_staging|FROM poi_photos_staging|FROM \(\(SELECT/.test(s))
    expect(gateSql.length).toBeGreaterThan(60)
    for (const g of gateSql) expect(g).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(\d+\) \*\/ /)
    expect(db.execLimits[0]).toBe(30000) // G2 at the start: the full scan cap
    expect(Math.max(...db.execLimits.slice(1))).toBeLessThanOrEqual(110000 - 70000 - 25000) // after: only what is left
  })

  it('a client-side timeout KILLs the query on the server from a fresh connection, then 503; lock released', async () => {
    withActive()
    await load()
    db.fail.push({ re: /^SELECT COUNT\(\*\) AS n FROM pois_staging$/, err: Object.assign(new Error('Query inactivity timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' }) })
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(503)
    expect(res.body.retry).toBe(true)
    expect(db.kills).toEqual([db.lockConnIds.at(-1)])
    expect(db.lockHeld).toBeNull()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a server-side stop (ER_QUERY_TIMEOUT) is a 503 with no KILL needed', async () => {
    withActive()
    await load()
    db.fail.push({ re: /^SELECT SUM\(/, err: Object.assign(new Error('maximum statement execution time exceeded'), { errno: 3024 }) })
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(503)
    expect(db.kills).toEqual([])
    expect(statusOf(BUILD)).toBe('loading')
  })

  it('a G6 query timeout is inconclusive: retryable 503, no verdict, no alert', async () => {
    db.fail.push({ re: /^SELECT COUNT\(\*\) AS n FROM \(/, err: Object.assign(new Error('Query inactivity timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' }) })
    withActive()
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(503)
    expect(res.headers['Retry-After']).toBe('5')
    expect(res.body.retry).toBe(true)
    expect(statusOf(BUILD)).toBe('loading')
    expect(db.builds.get(BUILD).gate_report).toBeNull()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('G6 stops at its time budget instead of running past the function limit', async () => {
    let clock = 1e12
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let calls = 0
    db.g6Count = () => { calls++; clock += 20000; return 5 }
    withActive()
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(503)
    expect(res.body.error).toMatch(/budget/)
    expect(calls).toBeLessThanOrEqual(4)
  })

  it('never starts the RENAME with under 20 s of the request left', async () => {
    let clock = 1e12
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    db.onSql = s => { if (s === 'SELECT COUNT(*) AS n FROM poi_photos_staging') clock += 95000 } // G7 lands at 95 s
    withActive({ prev: true })
    await load()
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(503)
    expect(res.body.error).toMatch(/time left/)
    expect(db.log.some(s => s.startsWith('RENAME'))).toBe(false)
    expect(db.tables.pois.comment).toBe(ACTIVE)
  })

  it('force with only the secret is a 404: a bot cannot force', async () => {
    withActive()
    await load()
    cases.G3()
    expect((await call({ step: 'finalize', force: '1' })).statusCode).toBe(404)
    expect(statusOf(BUILD)).toBe('loading')
  })

  it('an admin session can force a build past G3-G7', async () => {
    withActive()
    await load()
    cases.G3()
    expect((await call({ step: 'finalize' })).statusCode).toBe(422)
    getUserFromRequest.mockResolvedValue({ id: 7, is_admin: true })
    const res = await call({ step: 'finalize', force: '1' }, admin)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ forced: true, report: { forced_by: 7, passed: false } })
    expect(statusOf(BUILD)).toBe('active')
  })

  it('a swap blocked by readers times out as a retryable 503, leaving every table in place', async () => {
    withActive({ prev: true })
    await load()
    db.fail.push({ re: /^RENAME/, once: true, err: Object.assign(new Error('Lock wait timeout exceeded'), { errno: 1205, code: 'ER_LOCK_WAIT_TIMEOUT' }) })
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(503)
    expect(res.headers['Retry-After']).toBe('5')
    expect([db.tables.pois.comment, db.tables.pois_prev.comment, db.tables.pois_staging.comment]).toEqual([ACTIVE, OLDER, BUILD])
    expect(statusOf(ACTIVE)).toBe('active')
    expect((await call({ step: 'finalize' })).statusCode).toBe(200)
    expect(db.tables.pois.comment).toBe(BUILD)
  })

  it('a crash between RENAME and the status UPDATE is repaired; the re-sent finalize is a 200', async () => {
    withActive({ prev: true })
    await load()
    db.fail.push({ re: /status = IF\(build_id = \?, 'active', 'previous'\)/, once: true, err: new Error('connection lost') })
    expect((await call({ step: 'finalize' })).statusCode).toBe(500)
    expect(db.tables.pois.comment).toBe(BUILD)
    expect([statusOf(BUILD), statusOf(ACTIVE)]).toEqual(['validating', 'active'])
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: 'active', already: true })
    expect([statusOf(BUILD), statusOf(ACTIVE)]).toEqual(['active', 'previous'])
  })

  it('begin repairs the same crash too', async () => {
    withActive()
    db.builds.set(BUILD, { status: 'validating', chunks_total: 2, chunks_loaded: 2 })
    db.tables.pois.comment = BUILD
    expect((await call({ step: 'begin' })).body).toMatchObject({ noop: true })
    expect([statusOf(BUILD), statusOf(ACTIVE)]).toEqual(['active', 'previous'])
  })

  it('G4 checks every category from staging in one scan, not a sample', async () => {
    release(CHUNKS, { per_key_counts: { 'amenity=cafe': 3, 'leisure=park': 1, 'historic=castle': 2 } }) // no castles loaded
    withActive()
    db.builds.get(ACTIVE).gate_report.per_key_counts['historic=castle'] = 2
    await load()
    db.log.length = 0
    const res = await call({ step: 'finalize' })
    expect(res.body.report.gates.find(g => g.id === 'G4')).toMatchObject({ pass: false, detail: { unverified: [expect.stringMatching(/historic=castle/)] } })
    const scans = db.log.filter(s => /^SELECT (\/\*\+ MAX_EXECUTION_TIME\(\d+\) \*\/ )?SUM\(/.test(s))
    expect(scans).toHaveLength(1)
    expect(scans[0].match(/SUM\(/g)).toHaveLength(12)
  })

  it.each([['passes at', 1, 200, []], ['fails below', 2, 422, ['G5']]])('G5 %s 90%% of sentinels', async (_label, gone, status, failed) => {
    const good = [[1, 'British Museum'], [2, 'Cafe Two'], [3, 'Cafe Three']].map(([id, name]) => ({ type: 'node', id, name }))
    withActive()
    await load()
    writeSentinels([...good, ...good, ...good, ...Array.from({ length: gone }, (_, n) => ({ type: 'node', id: 98 + n, name: 'Gone' }))])
    const res = await call({ step: 'finalize' })
    expect(res.statusCode).toBe(status)
    expect(res.body.report.failed).toEqual(failed)
  })

  it('finalize refuses a failed build without an admin force', async () => {
    db.builds.set(BUILD, { status: 'failed', chunks_total: 2, chunks_loaded: 2 })
    expect((await call({ step: 'finalize' })).statusCode).toBe(409)
  })
})

// ─── CLI ────────────────────────────────────────────────────────

describe('scripts/poi/load.mjs', () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status })
  it('resumes, retries a 5xx and a busy lock, then finalizes', async () => {
    const { run } = await import('../../../scripts/poi/load.mjs')
    const calls = []
    let chunk3 = 0
    const fetchImpl = vi.fn(async url => {
      const q = Object.fromEntries(new URL(url).searchParams)
      calls.push(q.step + (q.i ?? ''))
      if (q.step === 'begin') return json(200, { resumed: true, chunks_loaded: 2, chunks_total: 4 })
      if (q.step === 'chunk' && q.i === '3' && chunk3++ === 0) return json(503, { error: 'blip', retry: true })
      if (q.step === 'chunk' && q.i === '3' && chunk3 === 2) return json(409, { error: 'busy', retry: true })
      if (q.step === 'finalize') return json(200, { status: 'active', report: { gates: [{ id: 'G1', name: 'schema', pass: true }] } })
      return json(200, { rows: 10 })
    })
    expect(await run({ build: BUILD, secret: 's', fetchImpl, sleep: async () => {}, log: () => {} })).toBe(0)
    expect(calls).toEqual(['begin', 'chunk2', 'chunk3', 'chunk3', 'chunk3', 'photos', 'finalize'])
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer s')
  })

  it('stops on a verdict (gates failed) without retrying', async () => {
    const { run } = await import('../../../scripts/poi/load.mjs')
    const fetchImpl = vi.fn(async url => {
      const step = new URL(url).searchParams.get('step')
      if (step === 'begin') return json(200, { resumed: false, chunks_loaded: 0, chunks_total: 0 })
      if (step === 'finalize') return json(422, { error: 'Gates failed', report: { gates: [] } })
      return json(200, {})
    })
    expect(await run({ build: BUILD, secret: 's', fetchImpl, sleep: async () => {}, log: () => {} })).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  // The workflow's Load step is `load.mjs ... && echo active=true`: exit codes are its contract
  const cli = async (respond, extra = {}) => {
    const { run, MAX_ATTEMPTS } = await import('../../../scripts/poi/load.mjs')
    const calls = []
    const lines = []
    const fetchImpl = vi.fn(async url => {
      const q = Object.fromEntries(new URL(url).searchParams)
      calls.push(q.step + (q.i ?? ''))
      return respond(q, calls.length)
    })
    const code = await run({ build: BUILD, secret: SECRET, skipPhotos: true, fetchImpl, sleep: async () => {}, log: l => lines.push(l), ...extra })
    expect(lines.join('\n')).not.toContain(SECRET)
    return { code, calls, MAX_ATTEMPTS }
  }

  it('begin says noop (already active): exit 0 with nothing else sent', async () => {
    const r = await cli(() => json(200, { build: BUILD, status: 'active', noop: true }))
    expect(r.code).toBe(0)
    expect(r.calls).toEqual(['begin'])
  })

  it('retries a network error or timeout, then carries on', async () => {
    const r = await cli((q, n) => {
      if (n === 1) throw new TypeError('fetch failed')
      if (n === 2) throw new DOMException('The operation timed out.', 'TimeoutError')
      if (q.step === 'begin') return json(200, { chunks_loaded: 0, chunks_total: 1 })
      if (q.step === 'finalize') return json(200, { status: 'active', report: { gates: [] } })
      return json(200, { rows: 1 })
    })
    expect(r.code).toBe(0)
    expect(r.calls).toEqual(['begin', 'begin', 'begin', 'chunk0', 'finalize'])
  })

  it('gives up after MAX_ATTEMPTS with a non-zero exit', async () => {
    const r = await cli(() => { throw new TypeError('fetch failed') })
    expect(r.code).not.toBe(0)
    expect(r.calls).toHaveLength(r.MAX_ATTEMPTS)
  })

  it.each([
    [409, { error: 'Chunks load in order; next is 0' }], [409, { retry: false }], [422, { error: 'bad chunk' }], [401, null],
  ])('a chunk %i without retry:true fails at once, no retry, no finalize', async (status, body) => {
    const r = await cli(q => (q.step === 'begin' ? json(200, { chunks_loaded: 0, chunks_total: 2 }) : json(status, body)))
    expect(r.code).not.toBe(0)
    expect(r.calls).toEqual(['begin', 'chunk0'])
  })
})

// ─── DDL (static) ───────────────────────────────────────────────

function parseDdl(sql) {
  const tables = {}
  for (const [, name, body] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\) ENGINE=InnoDB/g)) {
    tables[name] = body.split('\n').map(l => l.replace(/--.*$/, '').trim())
      .filter(l => /^[a-z0-9_]+\s+(INT|TINYINT|BIGINT|DOUBLE|VARCHAR|TEXT|SMALLINT|ENUM|DATE|DATETIME|TIMESTAMP|JSON|CHAR)\b/.test(l))
      .map(l => l.split(/\s+/)[0])
  }
  return tables
}

describe('database/phase11-pois.sql', () => {
  const ddl = readFileSync(join(ROOT, 'database', 'phase11-pois.sql'), 'utf8')
  const code = ddl.replace(/--.*$/gm, '')
  const tables = parseDdl(ddl)

  it('creates exactly pois, poi_photos, poi_builds, idempotently', () => {
    expect(Object.keys(tables)).toEqual(['pois', 'poi_photos', 'poi_builds'])
    expect(code.match(/CREATE TABLE(?! IF NOT EXISTS)/g)).toBeNull()
    expect(code).not.toMatch(/\b(DROP|ALTER|RENAME)\s+TABLE/)
  })

  it('has the planned columns and keys', () => {
    expect(tables.pois).toEqual(['cell', 'osm_type', 'osm_id', 'lat', 'lon', 'min_lat', 'min_lon', 'max_lat', 'max_lon',
      'k_amenity', 'k_tourism', 'k_leisure', 'k_historic', 'k_shop', 'k_natural', 'k_man_made',
      'has_name', 'has_name_tag', 'has_wikidata', 'el'])
    expect(tables.poi_photos).toEqual(['photo_key', 'url', 'width', 'height', 'source', 'artist', 'license',
      'license_url', 'page_url', 'checked_on'])
    expect(tables.poi_builds).toEqual(['build_id', 'release_tag', 'schema_version', 'osm_timestamp', 'chunks_total',
      'chunks_loaded', 'row_count', 'photo_count', 'coverage', 'status', 'gate_report', 'manifest_sha256', 'coverage_sha256',
      'gen_pending', 'created_at', 'activated_at'])
    expect(ddl).toMatch(/PRIMARY KEY \(cell, osm_type, osm_id\)/)
    expect(ddl).toMatch(/UNIQUE KEY uq_osm \(osm_type, osm_id\)/)
    expect(ddl).toMatch(/status ENUM\('loading','validating','active','previous','failed','rolled_back'\)/)
    // NO PAD binary: 'cafe ' must not equal 'cafe' (utf8mb4_bin is PAD SPACE)
    const kLines = ddl.split('\n').filter(l => /^\s+k_\w+/.test(l))
    expect(kLines).toHaveLength(7)
    for (const line of kLines) expect(line).toMatch(/VARCHAR\(48\) COLLATE utf8mb4_0900_bin NULL/)
    for (const c of ['min_lat', 'min_lon', 'max_lat', 'max_lon']) expect(ddl).toMatch(new RegExp(`${c}\\s+DOUBLE\\s+NOT NULL`))
  })

  it('the loader inserts exactly the pois columns, which are the CONTRACT chunk fields', () => {
    expect(INSERT_POIS.match(/\(([^)]+)\)/)[1].split(', ')).toEqual(tables.pois)
    expect(POI_COLS).toEqual(tables.pois)
    expect(Object.keys(poi(1, 'x')).sort()).toEqual([...tables.pois].sort())
  })

  it('schema.sql carries the same three tables', () => {
    const schema = parseDdl(readFileSync(join(ROOT, 'database', 'schema.sql'), 'utf8'))
    for (const t of ['pois', 'poi_photos', 'poi_builds']) expect(schema[t]).toEqual(tables[t])
  })
})
