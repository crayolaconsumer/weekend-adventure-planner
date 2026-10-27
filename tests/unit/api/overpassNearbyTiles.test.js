// nearby.js wiring of the static POI tiles (api/lib/poiTiles.js tilePois, mocked here; its
// answers are tested byte for byte against the DB in tests/unit/poi). Covers: the DB's
// fallback (T1), tiles-first behind poiTilesPct and the poi_tiles_shadow comparison (T2).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildDiscoverOverpassQuery } from '../../../shared/overpassQuery.js'

const store = new Map()
vi.mock('../../../api/lib/kvCache.js', async () => {
  const { createHash } = await import('node:crypto')
  return {
    cacheGet: async key => store.get(key) ?? null,
    cacheSet: async (key, value) => { store.set(key, value); return true },
    hashKey: v => createHash('sha1').update(v).digest('hex'),
    isCacheEnabled: () => true,
    getClient: () => null
  }
})
const flags = { poiDbPct: 100, poiShadowPct: 0, poiCapPct: 0, poiTilesPct: 0, poiTilesShadowPct: 0, poiTilesFallback: true }
vi.mock('../../../api/lib/flags.js', () => ({
  getFlags: async () => ({ ...flags }),
  peekFlags: () => ({ ...flags }),
  isFeatureEnabled: async () => true
}))
const background = []
vi.mock('@vercel/functions', () => ({ waitUntil: p => { background.push(p) } }))
const tilePois = vi.fn()
let tilesOn = true
let tilesBusyNow = false
vi.mock('../../../api/lib/poiTiles.js', () => ({ tilePois: (...a) => tilePois(...a), tilesConfigured: () => tilesOn, tilesBusy: () => tilesBusyNow }))

let build
let answer
const answerSql = async opts => {
  if (/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(opts.sql)) return [[]]
  if (opts.sql.includes('information_schema.tables')) return [[{ owner: build.build_id }]]
  if (opts.sql.includes('poi_builds')) return [[build]]
  return [(await answer()).map(r => ({ g: 0, ...r }))]
}
const poolQuery = vi.fn(answerSql)
vi.mock('../../../api/lib/db.js', () => ({
  getPool: () => ({ query: poolQuery }),
  getFreshConnection: async () => ({ query: poolQuery, release() {}, destroy() {} }),
  releaseConnection: c => c.release(),
  dedicatedConnection: async () => ({ query: poolQuery, end: async () => {}, destroy() {} }),
  runQuery: (sql, values = [], timeout) => poolQuery({ sql, values, timeout }, values),
}))

const { default: handler, tilesFallbackWaitMs, TILES_FIRST_MS } = await import('../../../api/places/overpass/nearby.js')
const { _resetPoiState, POI_SCHEMA_VERSION, CAP } = await import('../../../api/lib/poiQuery.js')
const { cellRanges } = await import('../../../shared/poiCell.mjs')
const { callOverpassProxy } = await import('../../../api/town.js')
const GB = cellRanges(49.9, -8, 60.9, 1.8).flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k))
const dbRuns = () => poolQuery.mock.calls.filter(c => c[0].sql.startsWith('(SELECT'))

const LIVE = { elements: [{ type: 'node', id: 1, lat: 51.5, lon: -0.12, tags: { name: 'Overpass Cafe', amenity: 'cafe' } }] }
const DB_EL = '{"type":"node","id":3,"lat":51.52,"lon":-0.11,"tags":{"name":"Bar","amenity":"bar"}}'
const DB_ROWS = [{ osm_type: 1, osm_id: 3, el: DB_EL }]
// The DB path's envelope (poiQuery.js), so a tile body can equal the served DB body byte for byte
const envelope = els => '{"version":0.6,"generator":"roam-poi-db","osm3s":{"timestamp_osm_base":"2026-09-27T02:15:00Z","copyright":' +
  '"The data included in this document is from www.openstreetmap.org. The data is made available under ODbL."},' + `"elements":[${els.join(',')}]}`
const TILES = { body: envelope([DB_EL]), n: 1, ids: ['node/3'], buildId: 'uk-20260927T0215Z', ms: 40, cached: false, bytesRead: 1234 }
const LONDON = buildDiscoverOverpassQuery(51.5074, -0.1278, 5000, null).query
const SYDNEY = buildDiscoverOverpassQuery(-33.8688, 151.2093, 5000, null).query
const TIMEOUT = () => Object.assign(new Error('Query execution was interrupted, maximum statement execution time exceeded'), { errno: 3024 })

let ip = 0
function call(query, extra = {}) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, headers: this.headers, body }); return this },
      send(text) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(text), raw: text }); return this },
      end() { resolve({ status: this.statusCode, headers: this.headers }); return this }
    }
    handler({ method: 'POST', headers: { 'x-forwarded-for': `10.2.0.${++ip}` }, body: { query, ...extra }, socket: {} }, res)
  })
}

describe('overpass nearby: static tiles', () => {
  let fetchMock
  let logs
  const places = () => logs.filter(l => typeof l === 'string' && l.includes('"evt":"places"')).map(l => JSON.parse(l))
  const shadowLines = () => logs.filter(l => typeof l === 'string' && l.includes('poi_tiles_shadow')).map(l => JSON.parse(l))
  beforeEach(() => {
    store.clear()
    background.length = 0
    _resetPoiState()
    poolQuery.mockClear()
    poolQuery.mockImplementation(answerSql)
    Object.assign(flags, { poiDbPct: 100, poiShadowPct: 0, poiCapPct: 0, poiTilesPct: 0, poiTilesShadowPct: 0, poiTilesFallback: true })
    build = { build_id: 'uk-20260927T0215Z', schema_version: POI_SCHEMA_VERSION, osm_timestamp: '2026-09-27T02:15:00Z', coverage: GB, features_version: 2 }
    answer = async () => DB_ROWS
    tilePois.mockReset()
    tilesOn = true
    tilesBusyNow = false
    tilePois.mockImplementation(async (plan, key, { trace }) => { trace.bytesRead = 1234; return TILES })
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => LIVE }))
    vi.stubGlobal('fetch', fetchMock)
    logs = []
    vi.spyOn(console, 'log').mockImplementation(line => logs.push(line))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // DB statements that read places (not session control, coverage or the table-owner check)
  const dataStatements = () => poolQuery.mock.calls.filter(c => !/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(c[0].sql) &&
    !c[0].sql.includes('information_schema') && !c[0].sql.includes('poi_builds')).length
  const dense = () => Array.from({ length: CAP + 50 }, (_, i) => ({ osm_type: 1, osm_id: 10 + i,
    el: JSON.stringify({ type: 'node', id: 10 + i, lat: 51.47 + (i % 70) / 1000, lon: -0.2 + Math.floor(i / 70) / 1000, tags: { name: `Cafe ${i}`, amenity: 'cafe' } }) }))
  const YORK = buildDiscoverOverpassQuery(53.959, -1.0815, 5000, null).query

  describe('T1: the DB\'s fallback', () => {
    it('budgets: tiles first gets 1.5 s; the fallback is waited for until 6.5 s into the request, never less than 500 ms', () => {
      expect(TILES_FIRST_MS).toBe(1500)
      expect([0, 1000, 6000, 6200, 9000].map(tilesFallbackWaitMs)).toEqual([6500, 5500, 500, 500, 500])
    })

    it('slot busy and the KV copy wins the race: served from KV, and no tile read is started for nothing', async () => {
      flags.poiDbPct = 0
      await call(LONDON) // Overpass fills KV
      flags.poiDbPct = 100
      await call(YORK) // coverage warm
      let release
      let gated = true
      answer = () => (gated ? (gated = false, new Promise(r => { release = () => r(DB_ROWS) })) : DB_ROWS)
      const holder = call(buildDiscoverOverpassQuery(51.38, -0.30, 5000, null).query) // holds the one SQL slot
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      tilePois.mockClear()
      const out = await call(LONDON)
      expect(out.headers['x-overpass-cache']).toBe('HIT')
      await sleep(200) // a fallback read would start within ~100 ms (activePoiBuild wait)
      expect(tilePois).not.toHaveBeenCalled()
      release()
      await holder
    })

    it('capped tile, DB fails at once, tiles say the build has no rows: no DB retry for it (it would say the same), the old path', async () => {
      flags.poiCapPct = 100
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async () => ({ ...TILES, body: envelope([]), n: 0, ids: [] }))
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(dataStatements()).toBe(1)
    }, 15000)

    it('26 Oct 18:46: the DB statement hits max_execution_time -> a fast tile answer, never Overpass', async () => {
      answer = async () => { throw TIMEOUT() }
      const t = performance.now()
      const out = await call(LONDON)
      expect(performance.now() - t).toBeLessThan(500)
      expect(out.status).toBe(200)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(out.headers['x-places-build']).toBe('uk-20260927T0215Z')
      expect(out.raw).toBe(TILES.body)
      expect(fetchMock).not.toHaveBeenCalled()
      // read from the build the DB holds, uncapped (poiCapPct 0)
      expect(tilePois.mock.calls[0][2]).toMatchObject({ buildId: 'uk-20260927T0215Z', cap: false })
      expect(places()[0]).toMatchObject({ src: 'tiles', n: 1, tiles_mode: 'fallback', tiles_bytes: 1234, tiles_cached: false, tiles_build: 'uk-20260927T0215Z' })
      expect(places()[0].tiles_ms).toBeTypeOf('number')
    })

    it('tiles answer before a KV copy of the old Overpass answer (they hold the DB\'s rows)', async () => {
      flags.poiDbPct = 0
      await call(LONDON) // Overpass fills KV
      flags.poiDbPct = 100
      await call(buildDiscoverOverpassQuery(53.959, -1.0815, 5000, null).query) // DB warm (coverage loaded)
      answer = async () => { throw TIMEOUT() }
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
    })

    it('the DB still running at its deadline: tiles answer, started when the first wait ended', async () => {
      answer = () => new Promise(() => {}) // hangs past POI_DEADLINE_MS
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('capped tile, DB failing: tiles get cap: true and serve within the app\'s 8 s budget', async () => {
      flags.poiCapPct = 100
      answer = async () => { throw TIMEOUT() }
      const t = performance.now()
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(performance.now() - t).toBeLessThan(7000)
      expect(tilePois.mock.calls[0][2].cap).toBe(true)
    }, 15000)

    it('tiles give nothing either (R2 down, breaker open): the old path, as before', async () => {
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async (p, k, { trace }) => { trace.why = 'breaker'; return null })
      const out = await call(LONDON)
      expect(out.headers['x-overpass-cache']).toBe('MISS')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(places()[0]).toMatchObject({ src: 'overpass', tiles_mode: 'fallback', tiles_why: 'breaker' })
    })

    it('18:46 on a capped tile: the DB fails slowly (1.2 s), tiles are ready at ~1 s -> tiles served then, ONE DB statement (no retry)', async () => {
      flags.poiCapPct = 100
      answer = async () => { await sleep(1200); throw TIMEOUT() }
      const t = performance.now()
      const out = await call(LONDON)
      const ms = performance.now() - t
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(ms).toBeLessThan(1150)
      await sleep(300) // let the first statement fail: no second one may follow it
      expect(dataStatements()).toBe(1)
    }, 15000)

    it('capped tile, DB fails at once, tiles answer at 300 ms: tiles served, no second DB statement', async () => {
      flags.poiCapPct = 100
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async () => { await sleep(300); return TILES })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      await sleep(100)
      expect(dataStatements()).toBe(1)
    }, 15000)

    it('capped tile, DB fails at once and tiles have nothing: the DB gets its second try (cold instance), and serves', async () => {
      flags.poiCapPct = 100
      let n = 0
      answer = async () => { if (n++ === 0) throw TIMEOUT(); return DB_ROWS }
      tilePois.mockImplementation(async (p, k, { trace }) => { trace.why = 'breaker'; return null })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('db')
      expect(dataStatements()).toBe(3) // the failed cap probe, then the retry's probe and today's statement
    }, 15000)

    it('capped tile, DB still running past its deadline, tiles at 2 s: served from tiles during the grace wait', async () => {
      flags.poiCapPct = 100
      answer = () => new Promise(() => {})
      tilePois.mockImplementation(async () => { await sleep(1700); return TILES }) // lands ~2.7 s in: inside the grace second
      const t = performance.now()
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(performance.now() - t).toBeLessThan(3200)
    }, 15000)

    it('capped tile, DB hanging: tiles served as they land, and no second statement is ever sent', async () => {
      flags.poiCapPct = 100
      answer = () => new Promise(() => {})
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      await sleep(200)
      expect(dataStatements()).toBe(1)
    }, 15000)

    it('DB failed, a KV copy exists and tiles are still reading: KV serves now (no wait for tiles)', async () => {
      flags.poiDbPct = 0
      await call(LONDON) // Overpass fills KV
      Object.assign(flags, { poiDbPct: 100, poiCapPct: 100 })
      await call(YORK) // DB warm
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async () => { await sleep(2000); return TILES })
      const t = performance.now()
      const out = await call(LONDON)
      expect(out.headers['x-overpass-cache']).toBe('HIT')
      expect(performance.now() - t).toBeLessThan(1500)
    }, 15000)

    it('DB failed at once, no KV copy, tiles take 1.5 s: still waited for (budget up to 6.5 s), served', async () => {
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async () => { await sleep(1500); return TILES })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(fetchMock).not.toHaveBeenCalled()
    }, 15000)

    it('tiles take longer than the budget: the old path, logged as a tiles timeout', async () => {
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(() => new Promise(() => {}))
      const t = performance.now()
      const out = await call(LONDON)
      expect(out.headers['x-overpass-cache']).toBe('MISS')
      expect(performance.now() - t).toBeGreaterThan(6000)
      expect(places()[0]).toMatchObject({ tiles_mode: 'fallback', tiles_why: 'timeout' })
    }, 15000)

    it('dog mode: a dog call started while the DB failed and tiles served the body: dogs_started logged', async () => {
      vi.stubEnv('GEOAPIFY_API_KEY', 'k')
      try {
        answer = async () => { await sleep(1100); throw TIMEOUT() }
        const out = await call(LONDON, { dogs: true, lat: 51.5074, lng: -0.1278, radius: 5000 })
        expect(out.headers['x-places-source']).toBe('tiles')
        expect(places()[0]).toMatchObject({ src: 'tiles', dogs_started: true })
      } finally {
        vi.unstubAllEnvs()
      }
    }, 15000)

    it('the fallback reads the DB\'s build (coverage) but may use current.json when it is unknown', async () => {
      answer = async () => { throw TIMEOUT() }
      await call(LONDON)
      expect(tilePois.mock.calls[0][2]).toMatchObject({ buildId: 'uk-20260927T0215Z' })
      expect(tilePois.mock.calls[0][2].exact).toBeFalsy()
    })

    it('tiles as fallback say the build has no rows: not served (an empty deck), the old path', async () => {
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async () => ({ ...TILES, body: envelope([]), n: 0, ids: [] }))
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('poiTilesFallback off (kill switch): no tile read, the old path', async () => {
      flags.poiTilesFallback = false
      answer = async () => { throw TIMEOUT() }
      await call(LONDON)
      expect(tilePois).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('the DB answered with no rows: that is an answer, no tile read', async () => {
      answer = async () => []
      await call(LONDON)
      expect(tilePois).not.toHaveBeenCalled()
    })

    it('the DB answered: served from the DB, no tile read (shadow off)', async () => {
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('db')
      expect(tilePois).not.toHaveBeenCalled()
    })

    it('outside GB/IE the tiles are never asked (Overpass/KV/GeoApify path untouched)', async () => {
      Object.assign(flags, { poiTilesPct: 100, poiTilesShadowPct: 100 })
      await call(SYDNEY)
      await Promise.all(background)
      expect(tilePois).not.toHaveBeenCalled()
    })
  })

  describe('T2: tiles first (poiTilesPct) and shadow (poiTilesShadowPct)', () => {
    it('poiTilesPct 100: served from tiles, the DB is never queried', async () => {
      flags.poiTilesPct = 100
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(out.raw).toBe(TILES.body)
      expect(dbRuns()).toHaveLength(0)
      expect(places()[0]).toMatchObject({ src: 'tiles', tiles_mode: 'first' })
    })

    it('tiles first serves exactly the DB\'s active build (coverage loaded first), never current.json by default', async () => {
      flags.poiTilesPct = 100
      await call(LONDON)
      expect(tilePois.mock.calls[0][2]).toMatchObject({ buildId: 'uk-20260927T0215Z', exact: true })
      expect(poolQuery.mock.calls.some(c => c[0].sql.includes('poi_builds'))).toBe(true)
    })

    it('tiles first while the DB\'s build is unknown (coverage unreadable): no exact read; the DB path\'s tiles fallback (current.json) serves', async () => {
      flags.poiTilesPct = 100
      poolQuery.mockImplementation(async () => { throw TIMEOUT() })
      const out = await call(LONDON)
      expect(tilePois).toHaveBeenCalledTimes(1)
      expect(tilePois.mock.calls[0][2]).toMatchObject({ buildId: null })
      expect(tilePois.mock.calls[0][2].exact).toBeFalsy()
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('critic P1: tiles-first bucket, DB hanging (coverage read 2 s, then fails), statements failing: ends in tiles, not Overpass', async () => {
      flags.poiTilesPct = 100
      poolQuery.mockImplementation(async opts => {
        if (opts.sql.includes('poi_builds')) { await sleep(2000); throw TIMEOUT() }
        if (/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(opts.sql)) return [[]]
        throw TIMEOUT()
      })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(fetchMock).not.toHaveBeenCalled()
    }, 20000)

    it('critic P2: tiles first takes 1.7 s (past TILES_FIRST_MS), the DB fails at once: the late tile answer serves', async () => {
      flags.poiTilesPct = 100
      await call(YORK) // coverage warm
      tilePois.mockClear()
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async () => { await sleep(1700); return TILES })
      const t = performance.now()
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(performance.now() - t).toBeLessThan(2200) // as it lands, not after another wait
      expect(tilePois).toHaveBeenCalledTimes(1) // the same read, not a second one
      expect(fetchMock).not.toHaveBeenCalled()
      expect(places().at(-1)).toMatchObject({ src: 'tiles', tiles_mode: 'first' })
      expect(places().at(-1).tiles_why).toBeUndefined() // served: not logged as a timeout
    }, 20000)

    it('critic P11: tiles first, the DB\'s build has no manifest on R2 (tiles step failed that night), DB fails: the fallback reads current.json and serves', async () => {
      flags.poiTilesPct = 100
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async (p, k, { exact, trace }) => {
        if (exact) { trace.why = 'no_build'; return null }
        return { ...TILES, buildId: 'uk-20260926T0215Z' } // yesterday's, via current.json
      })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(tilePois.mock.calls.map(c => Boolean(c[2].exact))).toEqual([true, false])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('tiles first gets its rows late, but the DB answered first with none: the DB\'s empty answer stands (tiles not served)', async () => {
      flags.poiTilesPct = 100
      await call(YORK) // coverage warm
      answer = async () => []
      tilePois.mockImplementation(async () => { await sleep(1700); return TILES })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }, 20000)

    it('tiles first in a bucket with no DB step (poiDbPct 0): a slow tiles-first answer is still waited for and served', async () => {
      Object.assign(flags, { poiTilesPct: 100, poiDbPct: 0 })
      await call(YORK)
      tilePois.mockImplementation(async () => { await sleep(1700); return TILES })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('tiles')
      expect(fetchMock).not.toHaveBeenCalled()
    }, 20000)

    it('rollout gate: tiles first only for buckets below poiTilesPct', async () => {
      const { snapQueryBbox } = await import('../../../api/lib/bboxSnap.js')
      const { createHash } = await import('node:crypto')
      const bucket = parseInt(createHash('sha1').update(snapQueryBbox(LONDON)).digest('hex').slice(0, 8), 16) % 100
      flags.poiTilesPct = bucket // LONDON's bucket is not below it: DB path
      await call(LONDON)
      expect(tilePois).not.toHaveBeenCalled()
      flags.poiTilesPct = bucket + 1 // now it is
      expect((await call(LONDON)).headers['x-places-source']).toBe('tiles')
    })

    it('capped tile, DB fails at once, the fallback (another build: current.json) says empty: the DB retry still runs', async () => {
      flags.poiCapPct = 100
      let n = 0
      answer = async () => { if (n++ === 0) throw TIMEOUT(); return DB_ROWS }
      tilePois.mockImplementation(async () => ({ ...TILES, body: envelope([]), n: 0, ids: [], buildId: 'uk-20990101T0000Z' }))
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('db')
      expect(dataStatements()).toBeGreaterThan(1)
    }, 15000)

    it('tiles first errored (not slow): no second tile read as the fallback', async () => {
      flags.poiTilesPct = 100
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async (p, k, { trace }) => { trace.why = 'error'; return null })
      await call(LONDON)
      expect(tilePois).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('after poi-rollback (new active build + generation bump) tiles first follows the DB to the rolled-back build', async () => {
      flags.poiTilesPct = 100
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
      await call(LONDON)
      expect(tilePois.mock.calls.at(-1)[2].buildId).toBe('uk-20260927T0215Z')
      build = { ...build, build_id: 'uk-20260920T0215Z' } // rollback: the previous build is active again
      store.set('roam:poiGen', 1)
      vi.setSystemTime(Date.now() + 31_000) // generation cache expired
      const seen = []
      for (let i = 0; i < 3; i++) {
        tilePois.mockClear()
        await call(buildDiscoverOverpassQuery(51.3 + i * 0.05, -0.12, 5000, null).query)
        await sleep(20)
        if (tilePois.mock.calls.length) seen.push(tilePois.mock.calls[0][2].buildId)
      }
      // The generation is read without waiting (peekPoiGen): the first request after its 30 s
      // cache expires still carries the old one and starts the refresh; from the next on, the
      // rolled-back build (a request while coverage reloads reads no tiles: no_db_build, the DB
      // serves). The DB path has the same window for its coverage
      expect(seen.slice(1).length).toBeGreaterThan(0)
      expect(seen.slice(1).every(b => b === 'uk-20260920T0215Z')).toBe(true)
    })

    it('tiles first, even with poiDbPct 0', async () => {
      Object.assign(flags, { poiTilesPct: 100, poiDbPct: 0 })
      expect((await call(LONDON)).headers['x-places-source']).toBe('tiles')
    })

    it('tiles first gives nothing: the DB answers, and tiles are not asked a second time', async () => {
      flags.poiTilesPct = 100
      tilePois.mockImplementation(async (p, k, { trace }) => { trace.why = 'error'; return null })
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('db')
      expect(tilePois).toHaveBeenCalledTimes(1)
      expect(places()[0]).toMatchObject({ src: 'db', tiles_mode: 'first', tiles_why: 'error' })
    })

    it('tiles first and the DB both fail: one tile try only, then the old path', async () => {
      flags.poiTilesPct = 100
      answer = async () => { throw TIMEOUT() }
      tilePois.mockImplementation(async () => null)
      await call(LONDON)
      expect(tilePois).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('tiles first, slower than TILES_FIRST_MS: the DB takes over and serves', async () => {
      flags.poiTilesPct = 100
      tilePois.mockImplementation(() => new Promise(() => {}))
      const t = performance.now()
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('db')
      const ms = performance.now() - t
      expect(ms).toBeGreaterThan(1400) // TILES_FIRST_MS (1.5 s) of tiles first ...
      expect(ms).toBeLessThan(2400) // ... then the DB's answer, not later
      expect(places()[0]).toMatchObject({ tiles_mode: 'first', tiles_why: 'timeout' })
    }, 15000)

    it('tiles first says the build has no rows: the old path at once (the DB would say the same)', async () => {
      flags.poiTilesPct = 100
      tilePois.mockImplementation(async () => ({ ...TILES, body: envelope([]), n: 0, ids: [] }))
      await call(LONDON)
      expect(dbRuns()).toHaveLength(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('rollout bucket: poiTilesPct 0 never reads tiles first', async () => {
      await call(LONDON)
      expect(tilePois).not.toHaveBeenCalled()
    })

    it('shadow: a DB-served answer is read from tiles after the response and compared byte for byte', async () => {
      flags.poiTilesShadowPct = 100
      const out = await call(LONDON)
      expect(out.headers['x-places-source']).toBe('db') // never served from the shadow
      expect(out.raw).toBe(TILES.body)
      await Promise.all(background)
      expect(tilePois.mock.calls[0][2]).toMatchObject({ buildId: 'uk-20260927T0215Z', cap: false })
      expect(shadowLines()).toEqual([expect.objectContaining({
        evt: 'poi_tiles_shadow', kind: 'area', db_build: 'uk-20260927T0215Z', tiles_build: 'uk-20260927T0215Z',
        n_db: 1, n_tiles: 1, bytes_equal: true, jaccard: 1, bytes_read: 1234, why: null, tiles_cached: false,
      })])
      expect(shadowLines()[0].tiles_ms).toBeTypeOf('number')
    })

    it('shadow logs a mismatch (jaccard, bytes_equal false) and a tile miss (why)', async () => {
      flags.poiTilesShadowPct = 100
      tilePois.mockImplementation(async () => ({ ...TILES, body: envelope([DB_EL, '{}']), n: 2, ids: ['node/3', 'node/4'] }))
      await call(LONDON)
      await Promise.all(background)
      expect(shadowLines()[0]).toMatchObject({ bytes_equal: false, jaccard: 0.5, n_tiles: 2 })
      tilePois.mockImplementation(async (p, k, { trace }) => { trace.why = 'not_covered'; return null })
      await call(buildDiscoverOverpassQuery(53.959, -1.0815, 5000, null).query)
      await Promise.all(background)
      expect(shadowLines()[1]).toMatchObject({ bytes_equal: false, jaccard: null, n_tiles: null, why: 'not_covered' })
    })

    it('shadow is capped exactly when the DB\'s answer was (its capPath), exact build', async () => {
      Object.assign(flags, { poiTilesShadowPct: 100, poiCapPct: 100 })
      answer = async () => dense()
      await call(LONDON)
      await Promise.all(background)
      expect(tilePois.mock.calls.at(-1)[2]).toMatchObject({ cap: true, exact: true })
      tilePois.mockClear()
      answer = async () => DB_ROWS // under CAP: served uncapped
      await call(YORK)
      await Promise.all(background)
      expect(tilePois.mock.calls.at(-1)[2].cap).toBe(false)
    })

    it('shadow with poiCapPct 0 on a dense tile: the DB served uncapped, so tiles are read uncapped', async () => {
      flags.poiTilesShadowPct = 100
      answer = async () => dense()
      await call(LONDON)
      await Promise.all(background)
      expect(tilePois.mock.calls.at(-1)[2].cap).toBe(false)
    })

    it('shadow on a deployment without R2 env: nothing read, no shadow line', async () => {
      flags.poiTilesShadowPct = 100
      tilesOn = false
      await call(LONDON)
      await Promise.all(background)
      expect(tilePois).not.toHaveBeenCalled()
      expect(shadowLines()).toHaveLength(0)
    })

    it('shadow yields to live work: skipped while tile decodes are queued on the instance', async () => {
      flags.poiTilesShadowPct = 100
      tilesBusyNow = true
      await call(LONDON)
      await Promise.all(background)
      expect(tilePois).not.toHaveBeenCalled()
    })

    it('shadow 0: no tile read', async () => {
      await call(LONDON)
      await Promise.all(background)
      expect(tilePois).not.toHaveBeenCalled()
      expect(shadowLines()).toHaveLength(0)
    })

    it('id lookups (lookupPlace through the in-process proxy) are served from tiles first', async () => {
      flags.poiTilesPct = 100
      const el = '{"type":"node","id":42,"lat":51.5,"lon":-0.1,"tags":{"name":"Pier","tourism":"attraction"}}'
      tilePois.mockImplementation(async plan => (plan.kind === 'id' ? { ...TILES, body: envelope([el]), ids: ['node/42'] } : null))
      const { status, body } = await callOverpassProxy('[out:json][timeout:10];(node(42);way(42););out tags center;', '10.9.9.9', handler, 5000)
      expect(status).toBe(200)
      expect(body.elements).toEqual([JSON.parse(el)])
      expect(dbRuns()).toHaveLength(0)
    })
  })
})
