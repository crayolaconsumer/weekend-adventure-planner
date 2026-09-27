import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map()
const cacheSet = vi.fn(async (k, v) => { store.set(k, v); return true })
vi.mock('../../../api/lib/kvCache.js', () => ({
  cacheGet: async k => store.get(k) ?? null,
  cacheSet: (...a) => cacheSet(...a),
  isCacheEnabled: () => true,
  getClient: () => null
}))

const { weekendEvents, weekendTtl, weekendWindow } = await import('../../../api/lib/townEvents.js')

const TOWN = { countryCode: 'gb', slug: 'st-albans', lat: 51.75, lng: -0.34 }
const MONDAY = new Date('2026-09-28T09:00:00Z')
const gig = { name: 'Gig', url: 'https://www.ticketmaster.co.uk/e/1', dates: { start: { localDate: '2026-10-03', localTime: '20:00:00' } } }

describe('weekendTtl', () => {
  it('lasts until 23:59 UK time on the Sunday (BST)', () => {
    // Sun 4 Oct 23:59 BST = 22:59 UTC
    expect(weekendTtl({ to: '2026-10-04' }, MONDAY)).toBe((Date.parse('2026-10-04T22:59:00Z') - MONDAY.getTime()) / 1000)
  })
  it('lasts until 23:59 UK time on the Sunday (GMT, after the clocks change)', () => {
    const now = new Date('2026-10-26T09:00:00Z')
    expect(weekendTtl({ to: '2026-11-01' }, now)).toBe((Date.parse('2026-11-01T23:59:00Z') - now.getTime()) / 1000)
  })
  it('never goes below a minute', () => {
    expect(weekendTtl({ to: '2026-10-04' }, new Date('2026-10-04T23:30:00Z'))).toBe(60)
  })
})

describe('weekendEvents cache', () => {
  beforeEach(() => { store.clear(); cacheSet.mockClear() })

  it('a person\'s miss fetches once and caches until the weekend is over', async () => {
    const tm = vi.fn(async (req, res) => res.status(200).json({ events: [gig] }))
    const out = await weekendEvents(TOWN, 'ip', tm, { now: MONDAY })
    expect(out.map(e => e.name)).toEqual(['Gig'])
    expect(cacheSet).toHaveBeenCalledTimes(1)
    const [key, , ttl] = cacheSet.mock.calls[0]
    expect(key).toBe(`town:events:v2:st-albans:${weekendWindow(MONDAY).from}`)
    expect(ttl).toBe(weekendTtl(weekendWindow(MONDAY), MONDAY))
    expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60) // Monday: most of a week, not 12h
    // second view is served from KV
    await weekendEvents(TOWN, 'ip', tm, { now: MONDAY })
    expect(tm).toHaveBeenCalledTimes(1)
  })

  it('an empty weekend is cached just as long (regression: 6h re-fetches burned quota)', async () => {
    const tm = vi.fn(async (req, res) => res.status(200).json({ events: [] }))
    await weekendEvents(TOWN, 'ip', tm, { now: MONDAY })
    expect(cacheSet.mock.calls[0][2]).toBe(weekendTtl(weekendWindow(MONDAY), MONDAY))
  })

  it('a crawler on a miss gets null and never calls Ticketmaster or writes the cache', async () => {
    const tm = vi.fn()
    expect(await weekendEvents(TOWN, 'ip', tm, { now: MONDAY, bot: true })).toBe(null)
    expect(tm).not.toHaveBeenCalled()
    expect(cacheSet).not.toHaveBeenCalled()
  })

  it('a crawler on a hit gets the cached events', async () => {
    store.set(`town:events:v2:st-albans:${weekendWindow(MONDAY).from}`, { value: [gig] })
    const tm = vi.fn()
    const out = await weekendEvents(TOWN, 'ip', tm, { now: MONDAY, bot: true })
    expect(out.map(e => e.name)).toEqual(['Gig'])
    expect(tm).not.toHaveBeenCalled()
  })
})
