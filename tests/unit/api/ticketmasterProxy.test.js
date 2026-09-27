import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '../../../api/events/ticketmaster.js'

let n = 0
async function call(query) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    getHeader(k) { return this.headers[k] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this }
  }
  await handler({ method: 'GET', query, headers: { 'x-forwarded-for': `10.9.0.${n++}` } }, res)
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
