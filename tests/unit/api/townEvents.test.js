import { describe, it, expect, vi } from 'vitest'
import { weekendWindow, pickWeekendEvents, eventWhen, weekendEvents } from '../../../api/lib/townEvents.js'

describe('weekendWindow (UK time)', () => {
  it.each([
    ['2026-09-28T09:00:00Z', '2026-10-02', '2026-10-04'], // Monday → coming Fri-Sun
    ['2026-10-01T22:30:00Z', '2026-10-02', '2026-10-04'], // Thu 23:30 BST
    ['2026-10-02T08:00:00Z', '2026-10-02', '2026-10-04'], // Friday
    ['2026-10-04T22:00:00Z', '2026-10-04', '2026-10-04'], // Sun 23:00 BST: just today
    ['2026-10-04T23:30:00Z', '2026-10-09', '2026-10-11'], // Mon 00:30 BST (still Sunday in UTC)
    ['2026-03-27T23:30:00Z', '2026-03-27', '2026-03-29'] // clocks-change weekend
  ])('%s → %s..%s', (now, from, to) => {
    expect(weekendWindow(new Date(now))).toEqual({ from, to })
  })
})

// The shape api/events/ticketmaster.js actually returns (regression: tests mocked
// Ticketmaster's raw _embedded shape, so the feature never showed an event)
const tm = events => ({ events, pagination: null, _links: null })
const ev = (name, date, time, extra = {}) => ({ name, url: 'https://www.ticketmaster.co.uk/e/1', dates: { start: { localDate: date, localTime: time } }, _embedded: { venues: [{ name: 'Alban Arena' }] }, ...extra })

describe('pickWeekendEvents', () => {
  const window = { from: '2026-10-02', to: '2026-10-04' }
  it('keeps this weekend only, soonest first, one per name, max 5', () => {
    const picked = pickWeekendEvents(tm([
      ev('Late show', '2026-10-03', '21:00:00'),
      ev('Early show', '2026-10-03', '10:00:00'),
      ev('Next week', '2026-10-10', '20:00:00'),
      ev('Early show', '2026-10-04', '10:00:00'),
      ev('Friday gig', '2026-10-02', null),
      ev('No link', '2026-10-03', '12:00:00', { url: 'javascript:alert(1)' })
    ]), window)
    expect(picked.map(e => e.name)).toEqual(['Friday gig', 'Early show', 'Late show'])
    expect(picked[1]).toMatchObject({ date: '2026-10-03', time: '10:00', venue: 'Alban Arena' })
  })
  it('hides events that are over, allowing 3h from the start (regression: morning events on Saturday night)', () => {
    const satEvening = new Date('2026-10-03T19:00:00Z') // 20:00 BST
    const picked = pickWeekendEvents(tm([
      ev('Morning market', '2026-10-03', '10:00:00'), // over
      ev('Matinee', '2026-10-03', '17:30:00'), // still on until 20:30
      ev('All-day fair', '2026-10-03', null),
      ev('Late gig', '2026-10-03', '22:00:00'),
      ev('Sunday roast', '2026-10-04', '12:00:00')
    ]), window, 5, satEvening)
    expect(picked.map(e => e.name)).toEqual(['All-day fair', 'Matinee', 'Late gig', 'Sunday roast'])
  })

  it('handles an empty or broken response', () => {
    expect(pickWeekendEvents(null, window)).toEqual([])
    expect(pickWeekendEvents({}, window)).toEqual([])
  })
})

describe('eventWhen', () => {
  it('reads like a UK listing', () => {
    expect(eventWhen({ date: '2026-10-03', time: '20:00' })).toBe('Sat 3 Oct, 8pm')
    expect(eventWhen({ date: '2026-10-03', time: '19:30' })).toBe('Sat 3 Oct, 7:30pm')
    expect(eventWhen({ date: '2026-10-03', time: '00:15' })).toBe('Sat 3 Oct, 12:15am')
    expect(eventWhen({ date: '2026-10-03', time: null })).toBe('Sat 3 Oct')
  })
})

describe('weekendEvents', () => {
  it('asks the Ticketmaster proxy around the town and picks this weekend', async () => {
    const proxy = vi.fn(async (req, res) => res.status(200).json(tm([ev('Gig', '2026-10-03', '20:00:00')])))
    const out = await weekendEvents({ countryCode: 'gb', slug: 'st-albans', lat: 51.75, lng: -0.34 }, '1.2.3.4', proxy, { now: new Date('2026-09-28T09:00:00Z') })
    expect(out.map(e => e.name)).toEqual(['Gig'])
    // asks for this weekend only, so busy cities aren't cut off at 50 results
    expect(proxy.mock.calls[0][0].query).toEqual({ lat: '51.75', lng: '-0.34', radius: '10', from: '2026-10-02', to: '2026-10-04' })
  })
  it('gives up after 2.5s rather than hold the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const hang = vi.fn(() => new Promise(() => {}))
    const p = weekendEvents({ countryCode: 'gb', slug: 'x', lat: 1, lng: 1 }, 'ip', hang)
    await vi.advanceTimersByTimeAsync(2600)
    expect(await p).toBe(null) // null = couldn't fetch; the page caches briefly
    vi.useRealTimers()
  })

  it('skips towns outside the UK (the proxy is GB-only) and survives proxy errors', async () => {
    const proxy = vi.fn(async (req, res) => res.status(500).json({ error: 'x' }))
    expect(await weekendEvents({ countryCode: 'fr', lat: 48.8, lng: 2.3 }, 'ip', proxy)).toEqual([])
    expect(proxy).not.toHaveBeenCalled()
    expect(await weekendEvents({ countryCode: 'gb', slug: 'y', lat: 51, lng: 0 }, 'ip', proxy)).toBe(null)
  })
})
