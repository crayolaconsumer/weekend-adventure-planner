// Serving side of the static POI tiles (api/lib/poiTiles.js tilePois + loadManifest) and the
// id index format (shared/poiTiles.mjs). Fixture builds are written to a temp dir with the
// real build script and read through localStore; no network.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { poiCell, OSM_TYPE_CODE } from '../../../shared/poiCell.mjs'
import { encodeIdIndex, decodeIdHeader, findIdCell, idShardOf, ID_HEADER_BYTES, ID_SHARDS } from '../../../shared/poiTiles.mjs'

vi.mock('../../../api/lib/kvCache.js', () => ({
  cacheGet: async () => null, cacheSet: async () => true, hashKey: v => v, isCacheEnabled: () => false, getClient: () => null,
}))
vi.mock('../../../api/lib/db.js', () => ({ runQuery: async () => [[]], getFreshConnection: async () => ({}), releaseConnection: () => {}, dedicatedConnection: async () => ({}) }))

const { parseQuery } = await import('../../../api/lib/poiQuery.js')
const { tilePois, answerCost, decodeLimited, decodeState, tilesBusy, DECODE_CONCURRENCY, _setTilesLruBudget, loadManifest, tilesBreakerState, tilesLruUsage, tilesStore, _resetTileState, TILES_SLOW_MS, TILES_LRU_BUDGET_BYTES } = await import('../../../api/lib/poiTiles.js')
const { localStore } = await import('../../../api/lib/poiStore.js')
const { groupRows, writeTiles } = await import('../../../scripts/poi/tiles.mjs')

function node(id, lat, lon, tags) {
  const el = { type: 'node', id, lat, lon, tags }
  return { cell: poiCell(lat, lon), osm_type: OSM_TYPE_CODE.node, osm_id: id, lat, lon, min_lat: lat, min_lon: lon, max_lat: lat, max_lon: lon,
    k_amenity: tags.amenity ?? null, k_tourism: null, k_leisure: null, k_historic: null, k_shop: null, k_natural: null, k_man_made: null,
    has_name: 1, has_name_tag: 1, has_wikidata: 0, q: 0, cat: 0, flags: 0, el: JSON.stringify(el) }
}
const meta = id => ({ build_id: id, schema_version: 1, features_version: 2, osm_timestamp: '2026-10-25T21:21:21.000Z' })
const cover = []
for (let lat = 51.05; lat < 52; lat += 0.1) for (let lon = -0.95; lon < 0; lon += 0.1) cover.push(poiCell(lat, lon))

// Two builds in one bucket: uk-a (cafe 1), then uk-b (cafe 1 renamed, plus cafe 2); current.json -> uk-b
const dir = mkdtempSync(join(tmpdir(), 'poi-serve-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const rowsA = [node(1, 51.5, -0.5, { amenity: 'cafe', name: 'Old' })]
const rowsB = [node(1, 51.5, -0.5, { amenity: 'cafe', name: 'New' }), node(2, 51.51, -0.51, { amenity: 'cafe', name: 'Two' })]
writeTiles(groupRows(rowsA, cover), meta('uk-a'), dir)
writeTiles(groupRows(rowsB, cover), meta('uk-b'), dir)

const QL = '[out:json][timeout:20][bbox:51.4,-0.6,51.6,-0.4];nwr["amenity"="cafe"];out center;'
const PLAN = parseQuery(QL)

// localStore with call counts, injectable failure and delay
const base = localStore(dir)
let calls
let fail
let slowBy
const store = {
  async get(k) { calls.get++; if (fail) throw new Error('R2 down'); return base.get(k) },
  async getRange(k, a, b) {
    calls.range++
    if (fail) throw new Error('R2 down')
    if (slowBy) vi.setSystemTime(Date.now() + slowBy) // the read "takes" slowBy ms
    return base.getRange(k, a, b)
  },
}

beforeEach(() => {
  _resetTileState()
  calls = { get: 0, range: 0 }
  fail = false
  slowBy = 0
})
afterEach(() => vi.useRealTimers())

describe('id index format', () => {
  it('round-trips: every id finds its cell, absent ids and wrong types find null', () => {
    const rows = [{ osm_type: 1, osm_id: 5, cell: 100 }, { osm_type: 2, osm_id: 5, cell: 200 }, { osm_type: 1, osm_id: 5 + ID_SHARDS, cell: 300 }, { osm_type: 3, osm_id: 77, cell: 0 }]
    const buf = encodeIdIndex(rows)
    const hdr = decodeIdHeader(buf)
    const shard = id => { const s = hdr[idShardOf(id)]; return buf.subarray(ID_HEADER_BYTES + s.offset, ID_HEADER_BYTES + s.offset + s.length) }
    expect(findIdCell(shard(5), 1, 5)).toBe(100)
    expect(findIdCell(shard(5), 2, 5)).toBe(200)
    expect(findIdCell(shard(5 + ID_SHARDS), 1, 5 + ID_SHARDS)).toBe(300) // same shard, no prefix confusion
    expect(findIdCell(shard(77), 3, 77)).toBe(0) // LARGE_CELL is a real answer
    expect(findIdCell(shard(5), 3, 5)).toBeNull()
    expect(findIdCell(shard(6), 1, 6)).toBeNull() // empty shard
    expect(findIdCell(shard(5), 1, 55)).toBeNull() // "1 55" must not match "1 5 "
  })
  it('an absent id never matches a longer id sharing its shard and digits (113 vs 1137)', () => {
    expect(idShardOf(113)).toBe(idShardOf(1137))
    const buf = encodeIdIndex([{ osm_type: 1, osm_id: 1137, cell: 500 }])
    const s = decodeIdHeader(buf)[idShardOf(113)]
    expect(findIdCell(buf.subarray(ID_HEADER_BYTES + s.offset, ID_HEADER_BYTES + s.offset + s.length), 1, 113)).toBeNull()
  })
  it('format contract with files already in R2: shard = osm_id % 1024, whatever the type', () => {
    expect([idShardOf(5), idShardOf(1029), idShardOf(1024)]).toEqual([5, 5, 0])
    const hdr = decodeIdHeader(encodeIdIndex([{ osm_type: 3, osm_id: 1029, cell: 1 }]))
    expect(hdr.findIndex(x => x.length > 0)).toBe(5)
  })
  it('rejects a bad header', () => {
    expect(() => decodeIdHeader(Buffer.alloc(ID_HEADER_BYTES))).toThrow(/not a POI id index/)
  })
})

describe('decode limiter and answer cost', () => {
  it('at most DECODE_CONCURRENCY decodes run at once; the rest queue; the rows are the same as the sync decode', async () => {
    const { encodeRows, decodeRows } = await import('../../../shared/poiTiles.mjs')
    const buf = encodeRows(Array.from({ length: 3000 }, (_, i) => node(i + 1, 51.5, -0.5, { amenity: 'cafe', name: `Café ŵ ${i}` })))
    let maxRunning = 0
    let sawQueue = false
    let busySeen = false
    const timer = setInterval(() => {
      const st = decodeState()
      maxRunning = Math.max(maxRunning, st.running)
      if (st.queued) sawQueue = true
      if (tilesBusy()) busySeen = true
    }, 0)
    const out = await Promise.all(Array.from({ length: 6 }, () => decodeLimited(buf)))
    clearInterval(timer)
    const st = decodeState()
    expect(DECODE_CONCURRENCY).toBe(2)
    expect(maxRunning).toBeLessThanOrEqual(DECODE_CONCURRENCY)
    expect(sawQueue).toBe(true)
    expect(busySeen).toBe(true)
    expect(st).toMatchObject({ running: 0, queued: 0 })
    expect(tilesBusy()).toBe(false)
    for (const rows of out) expect(rows).toEqual(decodeRows(buf))
  })

  it('the queue is first come, first served', async () => {
    const { encodeRows } = await import('../../../shared/poiTiles.mjs')
    const buf = encodeRows(Array.from({ length: 3000 }, (_, i) => node(i + 1, 51.5, -0.5, { amenity: 'cafe', name: `Q ${i}` })))
    // Two slots: a and b decode side by side and may finish in either order, so check the order
    // they STARTED in (time spent queued): a no later than b, and c only after a slot frees again
    const blockers = [decodeLimited(buf), decodeLimited(buf)]
    const t = { a: {}, b: {}, c: {} }
    await Promise.all([...blockers, ...['a', 'b', 'c'].map(k => decodeLimited(buf, t[k]))])
    expect(t.a.queueMs).toBeLessThanOrEqual(t.b.queueMs)
    expect(t.a.queueMs).toBeLessThan(t.c.queueMs)
  })

  it('queue time is wall-clock per request: parallel cell decodes waiting together count once', async () => {
    const { brotliCompressSync, constants } = await import('node:zlib')
    const heavy = brotliCompressSync(Buffer.alloc(64 << 20, 120), { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } })
    const { encodeRows } = await import('../../../shared/poiTiles.mjs')
    const cell = encodeRows([node(1, 51.5, -0.5, { amenity: 'cafe', name: 'c' })])
    const blockers = [decodeLimited(heavy).catch(() => {}), decodeLimited(heavy).catch(() => {})]
    const timing = {}
    const start = Date.now()
    await Promise.all([decodeLimited(cell, timing), decodeLimited(cell, timing), decodeLimited(cell, timing)])
    const wall = Date.now() - start
    await Promise.all(blockers)
    expect(timing.queueMs).toBeGreaterThan(0)
    expect(timing.queueMs).toBeLessThanOrEqual(wall) // a sum (3 overlapping waits) would exceed the wall clock
  })

  it('a failed decode frees its slot (the queue keeps moving)', async () => {
    const bad = Buffer.from('not brotli at all')
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => decodeLimited(bad)))
    expect(results.every(r => r.status === 'rejected')).toBe(true)
    expect(decodeState()).toMatchObject({ running: 0, queued: 0 })
  })

  it('answer cost: two bytes a character once the body has any non-Latin-1 character, plus the ids', () => {
    const latin = { body: 'Caf\u00e9 '.repeat(1000), ids: [] }
    const welsh = { body: 'Caf\u0175 '.repeat(1000), ids: [] }
    expect(answerCost(latin)).toBe(latin.body.length)
    expect(answerCost(welsh)).toBe(welsh.body.length * 2)
    expect(answerCost({ body: '', ids: ['node/123', 'way/4'] })).toBe(8 + 32 + 5 + 32)
  })
})

describe('loadManifest: the DB\'s active build first', () => {
  it('a known build id reads that build\'s manifest; unknown, missing or junk: current.json\'s', async () => {
    expect((await loadManifest(store, 'uk-a')).build_id).toBe('uk-a')
    expect((await loadManifest(store, 'uk-zzz')).build_id).toBe('uk-b')
    expect((await loadManifest(store, null)).build_id).toBe('uk-b')
    expect((await loadManifest(store, '../current')).build_id).toBe('uk-b')
  })
  it('exact: that build or nothing, never current.json\'s (tiles-first and shadow after a rollback)', async () => {
    expect((await loadManifest(store, 'uk-a', { exact: true })).build_id).toBe('uk-a')
    expect(await loadManifest(store, 'uk-zzz', { exact: true })).toBeNull()
    expect(await loadManifest(store, null, { exact: true })).toBeNull()
    const trace = {}
    expect(await tilePois(PLAN, QL, { store, buildId: 'uk-zzz', exact: true, trace })).toBeNull()
    expect(trace.why).toBe('no_build')
  })
  it('tiles answer from the build the DB holds (a rollback to uk-a serves uk-a\'s rows)', async () => {
    const a = await tilePois(PLAN, QL, { store, buildId: 'uk-a' })
    const b = await tilePois(PLAN, QL, { store, buildId: 'uk-b' })
    expect(a.buildId).toBe('uk-a')
    expect(a.body).toContain('"Old"')
    expect(b.body).toContain('"New"')
    expect(b.n).toBe(2)
  })
  it('a build manifest is read once (immutable); a failing store keeps serving the last good one', async () => {
    await loadManifest(store, 'uk-a')
    const n = calls.get
    await loadManifest(store, 'uk-a')
    expect(calls.get).toBe(n)
    await loadManifest(store) // current.json read once
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 61_000) // current.json is past its TTL
    fail = true
    expect((await loadManifest(store)).build_id).toBe('uk-b')
  })
})

describe('tilePois: answer LRU, in-flight dedupe, breaker', () => {
  it('R2 not configured: null at once, why "off"', async () => {
    const saved = process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_ACCESS_KEY_ID
    try {
      expect(tilesStore()).toBeNull()
      const trace = {}
      expect(await tilePois(PLAN, QL, { trace })).toBeNull()
      expect(trace.why).toBe('off')
    } finally {
      if (saved !== undefined) process.env.R2_ACCESS_KEY_ID = saved
    }
  })

  it('a repeat is an LRU hit: same body, no reads; capped and uncapped are kept apart', async () => {
    const first = await tilePois(PLAN, QL, { store })
    expect(first.cached).toBe(false)
    const reads = calls.range
    const trace = {}
    const again = await tilePois(PLAN, QL, { store, trace })
    expect(again).toMatchObject({ body: first.body, cached: true, ms: 0 })
    expect(trace.cached).toBe(true)
    expect(calls.range).toBe(reads)
    await tilePois(PLAN, QL, { store, cap: true })
    expect(tilesLruUsage().entries).toBe(2)
  })

  it('the LRU holds to its byte budget, oldest out first (budget shrunk to ~4 entries: fast)', async () => {
    const first = await tilePois(PLAN, QL, { store })
    const per = answerCost(first)
    expect(TILES_LRU_BUDGET_BYTES).toBe(16_000_000) // the production budget, as documented
    _setTilesLruBudget(per * 4 + 1)
    // fill past the budget with distinct keys (same plan, different cache key)
    for (let i = 0; i < 8; i++) await tilePois(PLAN, `${QL}#${i}`, { store })
    expect(tilesLruUsage().bytes).toBeLessThanOrEqual(per * 4 + 1)
    expect(tilesLruUsage().entries).toBe(4)
    calls.range = 0
    await tilePois(PLAN, QL, { store }) // the very first entry was evicted: read again
    expect(calls.range).toBeGreaterThan(0)
  })

  it('area reads decode every cell member through the limiter (and the LARGE member)', async () => {
    const before = decodeState().total
    const trace = {}
    await tilePois(PLAN, QL, { store, trace })
    expect(trace.reads).toBeGreaterThan(0)
    expect(decodeState().total - before).toBeGreaterThanOrEqual(trace.reads + 1)
  })

  it('an answer over 2 MB is cached too (a dense uncapped repeat or shadow sample reads R2 once)', async () => {
    const big = mkdtempSync(join(tmpdir(), 'poi-big-'))
    try {
      const rows = Array.from({ length: 40 }, (_, i) => {
        const r = node(100 + i, 51.45 + i * 0.002, -0.55 + i * 0.002, { amenity: 'cafe', name: `C${i}` })
        const el = JSON.parse(r.el)
        el.tags.description = 'x'.repeat(60000) + i
        return { ...r, el: JSON.stringify(el) }
      })
      writeTiles(groupRows(rows, cover), meta('uk-big'), big)
      const bigStore = { get: k => (calls.get++, localStore(big).get(k)), getRange: (k, a, b) => (calls.range++, localStore(big).getRange(k, a, b)) }
      const first = await tilePois(PLAN, QL, { store: bigStore })
      expect(Buffer.byteLength(first.body)).toBeGreaterThan(2_000_000)
      const reads = calls.range
      const again = await tilePois(PLAN, QL, { store: bigStore })
      expect(again.cached).toBe(true)
      expect(calls.range).toBe(reads)
    } finally {
      rmSync(big, { recursive: true, force: true })
    }
  })

  it('concurrent cold requests for different tiles download the LARGE member once', async () => {
    const gets = []
    const s2 = { get: k => (gets.push(k), base.get(k)), getRange: base.getRange }
    const qs = [0, 1, 2, 3].map(i => `[out:json][timeout:20][bbox:51.4,-0.6,51.6,${-0.4 + i * 0.01}];nwr["amenity"="cafe"];out center;`)
    await Promise.all(qs.map(q => tilePois(parseQuery(q), q, { store: s2 })))
    expect(gets.filter(k => k.startsWith('b/large.'))).toHaveLength(1)
  })

  it('a joined request logs the running read\'s outcome (why), not nothing', async () => {
    const away = '[out:json][timeout:20][bbox:55.1,-3.2,55.2,-3.1];nwr["amenity"="cafe"];out center;'
    const traces = [{}, {}]
    await Promise.all(traces.map(trace => tilePois(parseQuery(away), away, { store, trace })))
    expect(traces[1]).toMatchObject({ joined: true, why: 'not_covered' })
  })

  it('concurrent identical requests share one read', async () => {
    await tilePois(PLAN, 'warm-up', { store }) // manifest and headers cached
    _resetTileState()
    calls.range = 0
    await tilePois(PLAN, QL, { store })
    const one = calls.range
    _resetTileState()
    calls.range = 0
    const traces = [{}, {}, {}]
    const out = await Promise.all(traces.map(trace => tilePois(PLAN, QL, { store, trace })))
    expect(calls.range).toBe(one)
    expect(new Set(out.map(r => r.body)).size).toBe(1)
    expect(traces.filter(t => t.joined)).toHaveLength(2)
  })

  it('too big to read: null, and remembered (no second read of the same tile)', async () => {
    const trace = {}
    expect(await tilePois(PLAN, QL, { store, trace, maxReadBytes: 1 })).toBeNull()
    expect(trace.why).toBe('read_cap')
    calls.range = 0
    const again = {}
    expect(await tilePois(PLAN, QL, { store, trace: again, maxReadBytes: 1 })).toBeNull()
    expect(again).toMatchObject({ why: 'too_big', cached: true })
    expect(calls.range).toBe(0)
  })

  it('three R2 errors open the breaker: then null without touching R2; after a minute one probe, a success closes it', async () => {
    await tilePois(PLAN, 'warm', { store }) // manifest cached: errors come from the reads
    fail = true
    for (let i = 0; i < 3; i++) {
      const trace = {}
      expect(await tilePois(PLAN, `${QL}${i}`, { store, trace })).toBeNull()
      expect(trace.why).toBe('error')
    }
    expect(tilesBreakerState()).toBe('open')
    calls.range = 0
    const trace = {}
    expect(await tilePois(PLAN, `${QL}x`, { store, trace })).toBeNull()
    expect(trace.why).toBe('breaker')
    expect(calls.range).toBe(0)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_001)
    expect(tilesBreakerState()).toBe('half-open')
    fail = false
    expect(await tilePois(PLAN, `${QL}y`, { store })).not.toBeNull()
    expect(tilesBreakerState()).toBe('closed')
  })

  it('three manifest read failures open it too (R2 down before any manifest was cached)', async () => {
    fail = true
    for (let i = 0; i < 3; i++) await tilePois(PLAN, QL, { store })
    expect(tilesBreakerState()).toBe('open')
  })

  it('while open, not even an expired manifest is fetched: no request waits on a failing R2', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await tilePois(PLAN, 'warm', { store }) // current.json cached now
    vi.setSystemTime(Date.now() + 50_000)
    fail = true
    for (let i = 0; i < 3; i++) await tilePois(PLAN, `${QL}${i}`, { store }) // reads fail: open until +110 s
    vi.setSystemTime(Date.now() + 20_000) // +70 s: current.json past its 60 s TTL, breaker still open
    calls.get = 0
    calls.range = 0
    const trace = {}
    expect(await tilePois(PLAN, `${QL}z`, { store, trace })).toBeNull()
    expect(trace.why).toBe('breaker')
    expect(calls).toEqual({ get: 0, range: 0 })
  })

  it('half-open lets exactly one probe through; concurrent requests are refused until it lands', async () => {
    await tilePois(PLAN, 'warm', { store })
    fail = true
    for (let i = 0; i < 3; i++) await tilePois(PLAN, `${QL}${i}`, { store })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_001)
    fail = false
    const traces = [{}, {}, {}]
    const out = await Promise.all(traces.map((trace, i) => tilePois(PLAN, `${QL}h${i}`, { store, trace })))
    expect(out.filter(Boolean)).toHaveLength(1)
    expect(traces.filter(t => t.why === 'breaker')).toHaveLength(2)
    expect(tilesBreakerState()).toBe('closed')
  })

  it('critic P9: while the breaker is open, an answer this instance already holds is still served (no R2 request)', async () => {
    const held = await tilePois(PLAN, QL, { store })
    fail = true
    for (let i = 0; i < 3; i++) await tilePois(PLAN, `${QL}${i}`, { store })
    expect(tilesBreakerState()).toBe('open')
    calls.get = 0
    calls.range = 0
    const trace = {}
    const again = await tilePois(PLAN, QL, { store, trace })
    expect(again).toMatchObject({ body: held.body, cached: true })
    expect(calls).toEqual({ get: 0, range: 0 })
    const miss = {}
    expect(await tilePois(PLAN, `${QL}new`, { store, trace: miss })).toBeNull()
    expect(miss.why).toBe('breaker')
    expect(calls).toEqual({ get: 0, range: 0 })
  })

  it('open breaker and no manifest in memory yet: refused without any R2 request', async () => {
    fail = true
    for (let i = 0; i < 3; i++) await tilePois(PLAN, QL, { store })
    calls.get = 0
    const trace = {}
    expect(await tilePois(PLAN, QL, { store, trace })).toBeNull()
    expect(trace.why).toBe('breaker')
    expect(calls.get).toBe(0)
  })

  it('a burst queueing for decode slots (local CPU) does not count as slow R2: the breaker stays closed', async () => {
    // Blockers only have to hold both slots for a moment: ~64 MB of one byte decompresses for tens
    // of ms (then fails to parse, which frees the slot all the same) but compresses in ~0.1 s,
    // unlike real rows at quality 11 (a 40k-row fixture took 20 s and timed out under load)
    const { brotliCompressSync, constants } = await import('node:zlib')
    const heavy = brotliCompressSync(Buffer.alloc(64 << 20, 120), { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } })
    await tilePois(PLAN, 'warm', { store }) // manifest, headers and LARGE cached: what's left is the cell decode
    vi.useFakeTimers({ toFake: ['Date'] })
    for (let i = 0; i < 3; i++) {
      const blockers = [decodeLimited(heavy).catch(() => {}), decodeLimited(heavy).catch(() => {})] // both slots busy
      const read = tilePois(PLAN, `${QL}burst${i}`, { store })
      while (decodeState().queued === 0) await new Promise(r => setTimeout(r, 0))
      vi.setSystemTime(Date.now() + TILES_SLOW_MS + 500) // 2 s spent waiting in the queue
      await Promise.all(blockers)
      expect(await read).not.toBeNull()
    }
    expect(tilesBreakerState()).toBe('closed')
  }, 30000)

  it('a failed half-open probe re-opens it for another minute', async () => {
    await tilePois(PLAN, 'warm', { store })
    fail = true
    for (let i = 0; i < 3; i++) await tilePois(PLAN, `${QL}${i}`, { store })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_001)
    await tilePois(PLAN, `${QL}p`, { store })
    expect(tilesBreakerState()).toBe('open')
  })

  it('answers slower than TILES_SLOW_MS count as failures (served, but three open the breaker)', async () => {
    await tilePois(PLAN, 'warm', { store })
    vi.useFakeTimers({ toFake: ['Date'] })
    slowBy = TILES_SLOW_MS + 1
    for (let i = 0; i < 3; i++) expect(await tilePois(PLAN, `${QL}${i}`, { store })).not.toBeNull()
    expect(tilesBreakerState()).toBe('open')
  })

  it('a not-covered answer is not an R2 failure: the breaker stays closed', async () => {
    const away = '[out:json][timeout:20][bbox:55.1,-3.2,55.2,-3.1];nwr["amenity"="cafe"];out center;'
    for (let i = 0; i < 4; i++) {
      const trace = {}
      expect(await tilePois(parseQuery(away), `${away}${i}`, { store, trace })).toBeNull()
      expect(trace.why).toBe('not_covered')
    }
    expect(tilesBreakerState()).toBe('closed')
  })

  it('an id in a cell denser than SCAN_ROWS still answers (only the id\'s row reaches the envelope)', async () => {
    const { SCAN_ROWS } = await import('../../../api/lib/poiQuery.js')
    const dense = mkdtempSync(join(tmpdir(), 'poi-dense-'))
    try {
      const many = Array.from({ length: SCAN_ROWS + 1 }, (_, i) => node(10 + i, 51.5 + (i % 90) / 1000, -0.5 + Math.floor(i / 90) / 10000, { amenity: 'cafe', name: 'x' }))
      expect(new Set(many.map(r => r.cell)).size).toBe(1)
      writeTiles(groupRows(many, cover), meta('uk-dense'), dense)
      const ql = '[out:json][timeout:10];node(5000);out tags center;'
      const r = await tilePois(parseQuery(ql), ql, { store: localStore(dense) })
      expect(r.ids).toEqual(['node/5000'])
    } finally {
      rmSync(dense, { recursive: true, force: true })
    }
  }, 60000)

  it('id lookups go through the wrapper too (cached like any answer)', async () => {
    const ql = '[out:json][timeout:10];node(2);out tags center;'
    const r = await tilePois(parseQuery(ql), ql, { store })
    expect(r.ids).toEqual(['node/2'])
    expect((await tilePois(parseQuery(ql), ql, { store })).cached).toBe(true)
  })
})
