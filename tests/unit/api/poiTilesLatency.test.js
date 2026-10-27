// /api/admin/poi-tiles: R2 read latency from the function itself (T6). The store is a local
// fixture build behind the real serving code path; no network.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { poiCell } from '../../../shared/poiCell.mjs'

vi.mock('../../../api/lib/kvCache.js', () => ({ cacheGet: async () => null, cacheSet: async () => true, hashKey: v => v, isCacheEnabled: () => false, getClient: () => null }))
vi.mock('../../../api/lib/db.js', () => ({ runQuery: async () => [[]], query: async () => [], queryOne: async () => null }))
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => null }))
const fake = vi.hoisted(() => ({ store: null }))
vi.mock('../../../api/lib/poiTiles.js', async importOriginal => ({ ...(await importOriginal()), tilesStore: () => fake.store }))

const { localStore } = await import('../../../api/lib/poiStore.js')
const { groupRows, writeTiles } = await import('../../../scripts/poi/tiles.mjs')
const { default: handler } = await import('../../../api/admin/poi-tiles.js')

const dir = mkdtempSync(join(tmpdir(), 'poi-lat-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const rows = [51.5, 52.5, 53.5].map((lat, i) => {
  const el = { type: 'node', id: i + 1, lat, lon: -1.5, tags: { amenity: 'cafe', name: `C${i}` } }
  return { cell: poiCell(lat, -1.5), osm_type: 1, osm_id: i + 1, min_lat: lat, min_lon: -1.5, max_lat: lat, max_lon: -1.5, k_amenity: 'cafe',
    has_name_tag: 1, has_wikidata: 0, q: 0, cat: 0, flags: 0, el: JSON.stringify(el) }
})
writeTiles(groupRows(rows, rows.map(r => r.cell)), { build_id: 'uk-lat', schema_version: 1, features_version: 2, osm_timestamp: '2026-10-25T21:21:21.000Z' }, dir)

const SECRET = 'poi-load-secret-for-tests'
function call(headers = {}, query = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'GET', headers: { 'x-forwarded-for': '10.3.0.1', ...headers }, query, body: {} }, res)
  })
}
const bearer = { authorization: `Bearer ${SECRET}` }

describe('GET /api/admin/poi-tiles', () => {
  beforeEach(() => {
    process.env.POI_LOAD_SECRET = SECRET
    fake.store = localStore(dir)
  })

  it('with the loader secret: p50/p90 of header and cell reads over the build\'s blocks', async () => {
    const out = await call(bearer, { n: '5' })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ build: 'uk-lat', n: 3, errors: [] }) // 3 blocks in this build
    expect(out.body.header).toMatchObject({ samples: 3 })
    expect(out.body.cell).toMatchObject({ samples: 3 })
    for (const k of ['p50', 'p90', 'max']) expect(out.body.header[k]).toBeTypeOf('number')
    expect(out.body.cell.bytes_p50).toBeGreaterThan(0)
    expect(out.body.current_ms).toBeTypeOf('number')
  })

  it('R2 not configured here: 503 naming what is missing, no secrets', async () => {
    fake.store = null
    const out = await call(bearer)
    expect(out.status).toBe(503)
    expect(out.body.error).toMatch(/R2 not configured/)
  })

  it('a store error is a 502 with the R2 status only', async () => {
    fake.store = { get: async () => { throw new Error('R2 GET current.json: 403 AccessDenied') }, getRange: async () => Buffer.alloc(0) }
    const out = await call(bearer)
    expect(out.status).toBe(502)
    expect(out.body.error).toBe('R2 GET current.json: 403 AccessDenied')
  })

  it('a wrong secret is the admin 404', async () => {
    const out = await call({ authorization: 'Bearer nope', origin: 'https://go-roam.uk' })
    expect(out.status).toBe(404)
  })
})
