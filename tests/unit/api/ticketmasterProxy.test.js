import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '../../../api/events/ticketmaster.js'

let n = 0
async function call(query, url) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    getHeader(k) { return this.headers[k] },
    removeHeader(k) { delete this.headers[k] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this }
  }
  await handler({ method: 'GET', query, url, headers: { 'x-forwarded-for': `10.9.0.${n++}` } }, res)
  return res
}

describe('Ticketmaster proxy country', () => {
  let fetchMock
  beforeEach(() => {
    vi.stubEnv('TICKETMASTER_KEY', 'test-key')
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ _embedded: { events: [] } }) }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  const sent = () => new URL(fetchMock.mock.calls[0][0]).searchParams

  it('stays GB by default (the app\'s Events page), with the UK window unchanged', async () => {
    await call({ lat: '51.5', lng: '-0.1', from: '2026-10-02', to: '2026-10-04' })
    expect(sent().get('countryCode')).toBe('GB')
    expect(sent().get('startDateTime')).toBe('2026-10-01T23:00:00Z')
    expect(sent().get('endDateTime')).toBe('2026-10-04T23:59:59Z')
  })

  it('passes a town page\'s exact UTC bounds through', async () => {
    await call({ lat: '34.05', lng: '-118.24', start: '2026-10-02T07:00:00Z', end: '2026-10-05T06:59:59Z', country: 'us' })
    expect(sent().get('countryCode')).toBe('US')
    expect(sent().get('startDateTime')).toBe('2026-10-02T07:00:00Z')
    expect(sent().get('endDateTime')).toBe('2026-10-05T06:59:59Z')
  })

  it('ignores malformed bounds', async () => {
    await call({ lat: '51.5', lng: '-0.1', from: '2026-10-02', to: '2026-10-04', start: '2026-10-02', end: 'x' })
    expect(sent().get('startDateTime')).toBe('2026-10-01T23:00:00Z')
    expect(sent().get('endDateTime')).toBe('2026-10-04T23:59:59Z')
  })

  it('ignores a malformed country', async () => {
    await call({ lat: '51.5', lng: '-0.1', country: 'GB&apikey=x' })
    expect(sent().get('countryCode')).toBe('GB')
  })
})

// A Ticketmaster stand-in that honours the time bounds and, like the real one,
// returns one 50-event page sorted by date
function fakeTicketmaster(all) {
  return vi.fn(async url => {
    const p = new URL(url).searchParams
    const lo = Date.parse(p.get('startDateTime'))
    const hi = Date.parse(p.get('endDateTime'))
    const events = all.filter(e => e.utc >= lo && e.utc <= hi).sort((a, b) => a.utc - b.utc).slice(0, 50).map(({ utc, ...e }) => e) // eslint-disable-line no-unused-vars
    return { ok: true, json: async () => ({ _embedded: { events } }) }
  })
}

describe('town weekend events through the real proxy (regression: a padded window filled the page with Thursday)', () => {
  beforeEach(() => vi.stubEnv('TICKETMASTER_KEY', 'test-key'))
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it.each([
    ['Los Angeles', { countryCode: 'us', slug: 'los-angeles', lat: 34.05, lng: -118.24 }, -7],
    ['Sydney', { countryCode: 'au', slug: 'sydney', lat: -33.87, lng: 151.21 }, 10],
    ['New York', { countryCode: 'us', slug: 'new-york', lat: 40.71, lng: -74.0 }, -4]
  ])('%s: a busy Thursday evening doesn\'t crowd out the weekend', async (_, town, offsetH) => {
    const { weekendEvents } = await import('../../../api/lib/townEvents.js')
    const local = (date, time) => Date.parse(`${date}T${time}:00Z`) - offsetH * 3600000
    const ev = (name, date, time) => ({ name, url: 'https://www.ticketmaster.com/e/1', dates: { start: { localDate: date, localTime: `${time}:00` } }, utc: local(date, time) })
    // 60 events Thursday 19:00-23:55 local: more than a page, inside a ±14h padded window in every zone
    const thursday = Array.from({ length: 60 }, (_, i) => ev(`Thursday ${i}`, '2026-10-01', `${19 + Math.floor(i / 12)}:${String((i % 12) * 5).padStart(2, '0')}`))
    vi.stubGlobal('fetch', fakeTicketmaster([...thursday, ev('Friday gig', '2026-10-02', '20:00'), ev('Sunday show', '2026-10-04', '19:00')]))
    const { default: proxy } = await import('../../../api/events/ticketmaster.js')
    // Monday morning in the town
    const out = await weekendEvents(town, `10.8.0.${n++}`, proxy, { now: new Date(local('2026-09-28', '09:00')) })
    expect(out.map(e => e.name)).toEqual(['Friday gig', 'Sunday show'])
  })
})

describe('Ticketmaster proxy edge caching', () => {
  beforeEach(() => vi.stubEnv('TICKETMASTER_KEY', 'test-key'))
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('caches a good listing at the edge for 15 minutes, varied on Origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ _embedded: { events: [] } }) })))
    const res = await call({ lat: '53.96', lng: '-1.08' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=900, stale-while-revalidate=1800')
    expect(res.headers.Vary).toBe('Origin')
  })

  it.each([
    ['an upstream 500', { ok: false, status: 500 }, 500],
    ['an upstream 429', { ok: false, status: 429 }, 429],
  ])('never caches %s', async (_, upstreamRes, status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => upstreamRes))
    const res = await call({ lat: '53.96', lng: '-1.08' })
    expect(res.statusCode).toBe(status)
    expect(res.headers['Cache-Control']).toBe('private, no-store')
  })

  it('never caches a bad request', async () => {
    const res = await call({ lat: '999', lng: '-1.08' })
    expect(res.statusCode).toBe(400)
    expect(res.headers['Cache-Control']).toBe('private, no-store')
  })
})

describe('Ticketmaster proxy: shared ~1 km cells', () => {
  let fetchMock
  beforeEach(() => {
    vi.stubEnv('TICKETMASTER_KEY', 'test-key')
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ _embedded: { events: [] } }) }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  const http = query => call(query, `/api/events/ticketmaster?${new URLSearchParams(query)}`)

  it('307s raw GPS coordinates (old builds) to the rounded, CDN-shareable URL, without calling upstream', async () => {
    const res = await http({ lat: '51.507351', lng: '-0.127758', radius: '30', page: '1' })
    expect(res.statusCode).toBe(307)
    expect(res.headers.Location).toBe('/api/events/ticketmaster?lat=51.51&lng=-0.13&radius=30&page=1')
    expect(res.headers['Cache-Control']).toMatch(/public, max-age=0, s-maxage=\d+/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves already-rounded coordinates directly (current builds), including whole and negative values', async () => {
    for (const q of [{ lat: '51.51', lng: '-0.13' }, { lat: '52', lng: '-1' }, { lat: '-33.87', lng: '151.21' }]) {
      fetchMock.mockClear()
      const res = await http(q)
      expect(res.statusCode).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('never redirects in-process callers (town pages pass exact coordinates and no url)', async () => {
    const res = await call({ lat: '53.959965', lng: '-1.087298' })
    expect(res.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves invalid coordinates to the normal 400', async () => {
    expect((await http({ lat: 'abc', lng: '-0.1' })).statusCode).toBe(400)
    expect((await http({ lat: '91.123', lng: '0' })).statusCode).toBe(400)
    expect((await http({ lat: '', lng: '-0.12' })).statusCode).toBe(400) // not redirected to lat=0
    expect((await http({ lat: ' ', lng: '-0.12' })).statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the redirect target never redirects again', async () => {
    const first = await http({ lat: '51.5049999', lng: '-0.0050001' })
    const target = new URL(first.headers.Location, 'https://x')
    const second = await call(Object.fromEntries(target.searchParams), first.headers.Location)
    expect(second.statusCode).toBe(200)
  })
})
