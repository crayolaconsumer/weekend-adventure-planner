import { describe, it, expect, vi, afterEach } from 'vitest'
import process from 'node:process'
import { PREWARM_CITIES, ALL_RADII_SLUGS } from '../../../shared/prewarmCities.mjs'
import { inPoiRegion } from '../../../shared/overpassQuery.js'
import { haversineKm } from '../../../shared/geo.mjs'

const recordCronRun = vi.fn(async () => {})
vi.mock('../../../api/lib/cronRuns.js', () => ({ recordCronRun: (...a) => recordCronRun(...a) }))
const background = []
vi.mock('@vercel/functions', () => ({ waitUntil: p => { background.push(p); return p } }))
const { default: handler, TARGETS, DELAY_BETWEEN_CALLS_MS, STOP_AFTER_RATE_LIMITED } = await import('../../../api/cron/prewarm-overpass.js')

describe('prewarm city list', () => {
  it('150-200 cities, none in GB or Ireland (the POI DB answers there)', () => {
    expect(PREWARM_CITIES.length).toBeGreaterThanOrEqual(150)
    expect(PREWARM_CITIES.length).toBeLessThanOrEqual(200)
    expect(PREWARM_CITIES.filter(c => inPoiRegion(c.lat, c.lng)).map(c => c.name)).toEqual([])
  })

  it('valid coordinates, unique names, no two centres within 10 km (a duplicate)', () => {
    for (const c of PREWARM_CITIES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(85)
      expect(Math.abs(c.lng)).toBeLessThanOrEqual(180)
      expect(Number.isFinite(c.lat) && Number.isFinite(c.lng)).toBe(true)
    }
    expect(new Set(PREWARM_CITIES.map(c => c.name)).size).toBe(PREWARM_CITIES.length)
    const close = []
    for (let i = 0; i < PREWARM_CITIES.length; i++) {
      for (let j = i + 1; j < PREWARM_CITIES.length; j++) {
        if (haversineKm(PREWARM_CITIES[i].lat, PREWARM_CITIES[i].lng, PREWARM_CITIES[j].lat, PREWARM_CITIES[j].lng) < 10) close.push([PREWARM_CITIES[i].name, PREWARM_CITIES[j].name])
      }
    }
    expect(close).toEqual([])
  })

  it('covers every inhabited continent', () => {
    const has = (lat0, lat1, lng0, lng1) => PREWARM_CITIES.some(c => c.lat >= lat0 && c.lat <= lat1 && c.lng >= lng0 && c.lng <= lng1)
    expect(has(35, 70, -10, 40)).toBe(true) // Europe
    expect(has(15, 60, -130, -60)).toBe(true) // North America
    expect(has(-55, 12, -82, -34)).toBe(true) // South America
    expect(has(-35, 37, -18, 52)).toBe(true) // Africa
    expect(has(-10, 50, 60, 150)).toBe(true) // Asia
    expect(has(-47, -10, 110, 180)).toBe(true) // Oceania
  })

  it('every all-radii slug is in the list', () => {
    const slugs = new Set(PREWARM_CITIES.map(c => c.slug))
    for (const s of ALL_RADII_SLUGS) expect(slugs.has(s)).toBe(true)
  })
})

describe('prewarm pacing', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.CRON_SECRET })

  // GB/IE exactly as at HEAD before the worldwide change: the KV backup behind the POI DB
  const HEAD_GB_IE = [
    ['London', 51.5074, -0.1278], ['Manchester', 53.4808, -2.2426], ['Birmingham', 52.4862, -1.8904],
    ['Edinburgh', 55.9533, -3.1883], ['Glasgow', 55.8642, -4.2518], ['Bristol', 51.4545, -2.5879],
    ['Leeds', 53.8008, -1.5491], ['Liverpool', 53.4084, -2.9916], ['Newcastle', 54.9783, -1.6178],
    ['Sheffield', 53.3811, -1.4701], ['Cambridge', 52.2053, 0.1218], ['Oxford', 51.7520, -1.2577],
    ['Brighton', 50.8225, -0.1372], ['Bath', 51.3811, -2.3590], ['York', 53.9590, -1.0815],
    ['Cardiff', 51.4816, -3.1791], ['Belfast', 54.5973, -5.9301], ['Nottingham', 52.9548, -1.1581],
    ['Norwich', 52.6309, 1.2974], ['Plymouth', 50.3755, -4.1427], ['Luton', 51.8787, -0.4200],
    ['Dunstable', 51.8859, -0.5210], ['St Albans', 51.7553, -0.3360], ['Dublin', 53.3498, -6.2603],
  ]
  const HEAD_RADII = [['walking', 5000], ['transit', 15000], ['driving', 30000], ['dayTrip', 35000], ['explorer', 35000]]

  it('GB and Ireland are warmed exactly as before: same 24 cities, coordinates and 5 radii (120 queries)', () => {
    const gb = TARGETS.filter(t => inPoiRegion(t.lat, t.lng))
    expect(gb.map(t => [t.name, t.lat, t.lng, t.mode, t.queryRadius]))
      .toEqual(HEAD_GB_IE.flatMap(([name, lat, lng]) => HEAD_RADII.map(([mode, r]) => [name, lat, lng, mode, r])))
  })

  it('about 400 Overpass queries a night, 4 s apart: GB/IE and the launch set at all 5 radii, the rest at the first-open 5 km', () => {
    expect(TARGETS.length).toBe(HEAD_GB_IE.length * 5 + ALL_RADII_SLUGS.size * 5 + (PREWARM_CITIES.length - ALL_RADII_SLUGS.size))
    expect(TARGETS.length).toBeLessThanOrEqual(410)
    expect(DELAY_BETWEEN_CALLS_MS).toBeGreaterThanOrEqual(4000)
    for (const t of TARGETS.filter(t => !inPoiRegion(t.lat, t.lng) && !ALL_RADII_SLUGS.has(t.slug))) expect([t.mode, t.queryRadius]).toEqual(['walking', 5000])
  })

  it('warms one query per invocation with the cron bearer, so the proxy waits for Overpass', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    process.env.CRON_SECRET = 's3cret'
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'MISS' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = { status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await handler({ method: 'GET', url: '/api/cron/prewarm-overpass?index=0', query: { index: '0' }, headers: { authorization: 'Bearer s3cret', host: 'example.test' } }, res)
    expect(res.code).toBe(202)
    await vi.advanceTimersByTimeAsync(DELAY_BETWEEN_CALLS_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1) // the warm; the next link waits out the delay
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/places\/overpass\/nearby$/)
    expect(init.headers.Authorization).toBe('Bearer s3cret')
    await vi.advanceTimersByTimeAsync(2)
    await Promise.all(background)
    expect(fetchMock).toHaveBeenCalledTimes(2) // then one dispatch of the next link
    expect(fetchMock.mock.calls[1][0]).toMatch(/index=1/)
    vi.useRealTimers()
  })
})

describe('prewarm stops on a run of Overpass 429s', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.CRON_SECRET; recordCronRun.mockClear(); background.length = 0 })

  // One chain link: warm TARGETS[index] with `warm` as the proxy's answer, then report what followed
  async function step(index, streak, warm) {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    process.env.CRON_SECRET = 's3cret'
    const fetchMock = vi.fn(async url => (String(url).includes('/nearby') ? warm : { ok: true, status: 202, headers: { get: () => null } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = { status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await handler({ method: 'GET', url: `/api/cron/prewarm-overpass?index=${index}`, query: { index: String(index), streak: String(streak) }, headers: { authorization: 'Bearer s3cret', host: 'example.test' } }, res)
    await vi.advanceTimersByTimeAsync(DELAY_BETWEEN_CALLS_MS + 10)
    await Promise.all(background)
    const next = fetchMock.mock.calls.find(c => !String(c[0]).includes('/nearby'))
    return next ? Object.fromEntries(new URL(next[0]).searchParams) : null
  }
  const rateLimited = { ok: false, status: 503, headers: { get: h => (h === 'x-overpass-upstream' ? 'rate-limited' : null) } }
  const otherFailure = { ok: false, status: 503, headers: { get: () => null } }
  const warmed = { ok: true, status: 200, headers: { get: () => 'MISS' } }

  it('counts consecutive rate-limited warms and stops the night at 3, recording why', async () => {
    expect(STOP_AFTER_RATE_LIMITED).toBe(3)
    expect((await step(10, 0, rateLimited)).streak).toBe('1')
    expect((await step(11, 1, rateLimited)).streak).toBe('2')
    expect(await step(12, 2, rateLimited)).toBeNull() // no next link
    expect(recordCronRun).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('rate-limited 3 warms in a row') }))
  })

  it('our own 429 counts too; only a real warm resets the streak; other failures leave it', async () => {
    expect((await step(10, 0, { ok: false, status: 429, headers: { get: () => null } })).streak).toBe('1')
    expect((await step(11, 2, otherFailure)).streak).toBe('2')
    expect((await step(12, 2, warmed)).streak).toBe('0')
  })

  // Regression (critic round 4 P1/P2): after a 429 the proxy serves the stale copy with a 200, which
  // nearly every target has; reading the header only on a failure meant the stop never fired
  it('a 200 carrying the rate-limited header (stale copy, or a mirror\'s empty body) counts as rate-limited', async () => {
    const staleAfter429 = { ok: true, status: 200, headers: { get: h => ({ 'x-overpass-upstream': 'rate-limited', 'x-overpass-cache': 'STALE' })[h] ?? null } }
    expect((await step(10, 1, staleAfter429)).streak).toBe('2')
    expect(await step(11, 2, staleAfter429)).toBeNull()
    expect(recordCronRun).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('rate-limited 3 warms in a row') }))
  })

  // Regression (critic round 4 P3): a rate-limiting Overpass mixes 429s and timeouts
  it('429, timeout, 429, timeout, 429 stops at the third 429', async () => {
    let streak = 0
    const seq = [rateLimited, otherFailure, rateLimited, otherFailure]
    for (let i = 0; i < seq.length; i++) streak = Number((await step(20 + i, streak, seq[i])).streak)
    expect(streak).toBe(2)
    expect(await step(24, streak, rateLimited)).toBeNull()
  })
})
