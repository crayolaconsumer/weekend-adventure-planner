// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import process from 'node:process'

// The poi_photos tier of image-resolve: a hit keeps the live response shape
// and cache headers; a miss, an error, a slow database or a missing table
// all fall through to the live chain.
const { dbQuery } = vi.hoisted(() => ({ dbQuery: vi.fn() }))
vi.mock('../../../api/lib/db.js', () => ({ query: (...a) => dbQuery(...a) }))
vi.mock('../../../api/lib/rateLimit.js', () => ({
  applyRateLimit: () => null,
  dropRateLimitHeaders: () => {},
  RATE_LIMITS: { API_GENERAL: {} },
}))
vi.mock('../../../api/lib/cors.js', () => ({ withCors: h => h }))
// The tier rides the poiDbPct rollout flag; 100 unless a test says otherwise
const flagState = vi.hoisted(() => ({ flags: { poiDbPct: 100 }, getFlags: null }))
vi.mock('../../../api/lib/flags.js', () => ({
  peekFlags: () => flagState.flags,
  getFlags: (...a) => flagState.getFlags(...a),
}))

let handler
beforeEach(async () => {
  // Fresh module per test: the memory cache and the DB back-off are module state
  vi.resetModules()
  dbQuery.mockReset()
  flagState.flags = { poiDbPct: 100 }
  flagState.getFlags = vi.fn(async () => ({ poiDbPct: 100 }))
  process.env.MYSQL_HOST = 'db.test'
  handler = (await import('../../../api/places/image-resolve.js')).default
})
afterEach(() => {
  delete process.env.MYSQL_HOST
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function call(query) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); return this },
    }
    handler({ method: 'GET', query, headers: {} }, res)
  })
}

const LIVE_P18 = 'York Minster west front.jpg'
function liveUpstream() {
  const fetch = vi.fn(async url => {
    if (url.includes('wikidata.org')) {
      return { ok: true, status: 200, json: async () => ({ entities: { Q1: { claims: { P625: [{}], P18: [{ mainsnak: { datavalue: { value: LIVE_P18 } } }] } } } }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const ROW = {
  url: 'https://commons.wikimedia.org/wiki/Special:FilePath/York_Minster_%28west%29.jpg?width=800',
  source: 'wikidata',
  artist: 'Jane Doe',
  license: 'CC BY-SA 4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0',
  page_url: 'https://commons.wikimedia.org/wiki/File:York_Minster_(west).jpg'
}
const minster = { name: 'York Minster', category: 'historic', wikipedia: 'en:York Minster', wikidata: 'Q1' }

describe('image-resolve poi_photos tier', () => {
  it('a hit answers with the live shape plus artist and licence, no upstream call, same cache header', async () => {
    dbQuery.mockResolvedValue([ROW])
    const fetch = liveUpstream()
    const { status, body, headers } = await call(minster)
    expect(status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    expect(body).toEqual({
      url: ROW.url,
      source: 'wikidata',
      attribution: {
        name: 'York Minster (west).jpg',
        url: ROW.page_url,
        source: 'Wikimedia Commons',
        artist: 'Jane Doe',
        license: 'CC BY-SA 4.0',
        license_url: ROW.license_url
      }
    })
    expect(headers['cache-control']).toBe('public, s-maxage=86400, stale-while-revalidate=604800')
    const [sql, params] = dbQuery.mock.calls[0]
    expect(sql).toMatch(/MAX_EXECUTION_TIME\(300\)/)
    expect(sql).toMatch(/FROM poi_photos WHERE photo_key = \?/)
    expect(params).toEqual(['Q1'])
  })

  it('a miss falls through to the live chain, which now carries null artist/licence', async () => {
    dbQuery.mockResolvedValue([])
    const fetch = liveUpstream()
    const { body } = await call(minster)
    expect(fetch).toHaveBeenCalled()
    expect(body.source).toBe('wikidata')
    expect(body.url).toContain('York%20Minster%20west%20front.jpg')
    expect(body.attribution).toMatchObject({ name: LIVE_P18, source: 'Wikimedia Commons', artist: null, license: null, license_url: null })
  })

  it('a database error falls through, logs once, then skips the database for a while', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    dbQuery.mockRejectedValue(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))
    liveUpstream()
    expect((await call(minster)).body.source).toBe('wikidata')
    expect((await call({ ...minster, name: 'York Minster 2' })).body.source).toBe('wikidata')
    expect(dbQuery).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a missing table (not loaded yet) falls through silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    dbQuery.mockRejectedValue(Object.assign(new Error("Table 'poi_photos' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }))
    liveUpstream()
    const { body } = await call(minster)
    expect(body.url).toContain('York%20Minster%20west%20front.jpg')
    await call({ ...minster, name: 'York Minster 2' })
    expect(dbQuery).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a hung database is abandoned after 500 ms', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    dbQuery.mockReturnValue(new Promise(() => {}))
    liveUpstream()
    const t0 = Date.now()
    const { body } = await call(minster)
    expect(body.source).toBe('wikidata')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(450)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('a venue still prefers its own website image over the database photo', async () => {
    dbQuery.mockResolvedValue([ROW])
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => 'text/html' },
      body: { getReader: () => {
        let sent = false
        return { read: async () => sent ? { done: true } : (sent = true, { value: new TextEncoder().encode('<head><meta property="og:image" content="https://cafe.example/hero.jpg"></head>') }), cancel() {} }
      } }
    })))
    const { body } = await call({ name: 'Cafe', category: 'food', website: 'https://cafe.example', wikidata: 'Q1' })
    expect(body.source).toBe('website-og')
    expect(body.attribution).toMatchObject({ license: null, artist: null })
  })

  it.each([
    ['rollout at 0', { poiDbPct: 0 }],
    ['flags not cached yet (cold instance)', null],
  ])('%s: live chain only, no database call', async (_, flags) => {
    flagState.flags = flags
    const fetch = liveUpstream()
    const { body } = await call({ wikidata: 'Q1', name: 'York Minster' })
    expect(dbQuery).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalled()
    expect(body.url).toContain('York%20Minster%20west%20front.jpg')
    expect(flagState.getFlags).toHaveBeenCalledTimes(flags ? 0 : 1)
  })

  it('never queries for a malformed QID', async () => {
    liveUpstream()
    await call({ wikidata: 'Q012', name: 'York Minster' })
    expect(dbQuery).not.toHaveBeenCalled()
  })

  it('does not touch the database without a QID or without database config', async () => {
    liveUpstream()
    await call({ name: 'Somewhere', category: 'historic', wikipedia: 'en:Somewhere' })
    await call({ ...minster, wikidata: 'Q1 OR 1=1' })
    delete process.env.MYSQL_HOST
    await call({ ...minster, name: 'No db config' })
    expect(dbQuery).not.toHaveBeenCalled()
  })
})
