import { describe, it, expect, vi } from 'vitest'
import { weekendWindow, weekendTtl, pickWeekendEvents, eventWhen, weekendEvents, townTimeZone, weekendQueryRange } from '../../../api/lib/townEvents.js'

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
    ]), window, 5, new Date('2026-10-02T08:00:00Z')) // a fixed "now": the default made this fail once the date passed
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
    // asks for this weekend only (Fri 00:00 to Sun 23:59:59 BST), so busy cities aren't cut off at 50 results
    expect(proxy.mock.calls[0][0].query).toEqual({ lat: '51.75', lng: '-0.34', radius: '10', country: 'GB', start: '2026-10-01T23:00:00Z', end: '2026-10-04T22:59:59Z' })
  })
  it('gives up after 2.5s rather than hold the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const hang = vi.fn(() => new Promise(() => {}))
    const p = weekendEvents({ countryCode: 'gb', slug: 'x', lat: 1, lng: 1 }, 'ip', hang)
    await vi.advanceTimersByTimeAsync(2600)
    expect(await p).toBe(null) // null = couldn't fetch; the page caches briefly
    vi.useRealTimers()
  })

  it('skips countries Ticketmaster doesn\'t cover for us and survives proxy errors', async () => {
    const proxy = vi.fn(async (req, res) => res.status(500).json({ error: 'x' }))
    expect(await weekendEvents({ countryCode: 'fr', lat: 48.8, lng: 2.3 }, 'ip', proxy)).toEqual([])
    expect(proxy).not.toHaveBeenCalled()
    expect(await weekendEvents({ countryCode: 'gb', slug: 'y', lat: 51, lng: 0 }, 'ip', proxy)).toBe(null)
  })
})

describe('world towns: events in the town\'s own weekend', () => {
  it.each([
    ['sydney', { countryCode: 'au', lat: -33.87, lng: 151.21 }, 'Australia/Sydney'],
    ['melbourne', { countryCode: 'au', lat: -37.81, lng: 144.96 }, 'Australia/Sydney'],
    ['brisbane (no DST)', { countryCode: 'au', lat: -27.47, lng: 153.03 }, 'Australia/Brisbane'],
    ['gold coast', { countryCode: 'au', lat: -28.0, lng: 153.43 }, 'Australia/Brisbane'],
    ['perth', { countryCode: 'au', lat: -31.95, lng: 115.86 }, 'Australia/Perth'],
    ['adelaide', { countryCode: 'au', lat: -34.93, lng: 138.6 }, 'Australia/Adelaide'],
    ['darwin', { countryCode: 'au', lat: -12.46, lng: 130.84 }, 'Australia/Darwin'],
    ['los angeles', { countryCode: 'us', lat: 34.05, lng: -118.24 }, 'America/Los_Angeles'],
    ['phoenix (no DST)', { countryCode: 'us', lat: 33.45, lng: -112.07 }, 'America/Phoenix'],
    ['denver', { countryCode: 'us', lat: 39.74, lng: -104.99 }, 'America/Denver'],
    ['chicago', { countryCode: 'us', lat: 41.88, lng: -87.63 }, 'America/Chicago'],
    ['nashville', { countryCode: 'us', lat: 36.16, lng: -86.78 }, 'America/Chicago'],
    ['indianapolis', { countryCode: 'us', lat: 39.77, lng: -86.16 }, 'America/New_York'],
    ['new york', { countryCode: 'us', lat: 40.71, lng: -74.0 }, 'America/New_York'],
    ['honolulu', { countryCode: 'us', lat: 21.31, lng: -157.86 }, 'Pacific/Honolulu'],
    ['vancouver', { countryCode: 'ca', lat: 49.28, lng: -123.12 }, 'America/Vancouver'],
    ['calgary', { countryCode: 'ca', lat: 51.05, lng: -114.07 }, 'America/Edmonton'],
    ['toronto', { countryCode: 'ca', lat: 43.65, lng: -79.38 }, 'America/Toronto'],
    ['halifax', { countryCode: 'ca', lat: 44.65, lng: -63.57 }, 'America/Halifax'],
    ['dublin', { countryCode: 'ie', lat: 53.35, lng: -6.26 }, 'Europe/Dublin'],
    ['auckland', { countryCode: 'nz', lat: -36.85, lng: 174.76 }, 'Pacific/Auckland'],
    ['london', { countryCode: 'gb', lat: 51.5, lng: -0.12 }, 'Europe/London']
  ])('%s time zone', (_, town, tz) => {
    expect(townTimeZone(town)).toBe(tz)
  })

  it.each([
    // Sydney is UTC+10 until 4 Oct 2026, then +11 (AEDT)
    ['2026-10-01T13:59:00Z', '2026-10-02', '2026-10-04'], // Thu 23:59 Sydney: coming Fri-Sun
    ['2026-10-01T14:00:00Z', '2026-10-02', '2026-10-04'], // Fri 00:00 Sydney, still Thursday in London
    ['2026-10-03T14:30:00Z', '2026-10-04', '2026-10-04'], // Sun 00:30 Sydney: just today
    ['2026-10-04T13:30:00Z', '2026-10-09', '2026-10-11'] // Mon 00:30 AEDT, still Sunday in UTC
  ])('Sydney %s → %s..%s', (now, from, to) => {
    expect(weekendWindow(new Date(now), 'Australia/Sydney')).toEqual({ from, to })
  })

  it.each([
    // Los Angeles is UTC-7 (PDT)
    ['2026-10-02T06:59:00Z', '2026-10-02', '2026-10-04'], // Thu 23:59 LA, already Friday in London
    ['2026-10-05T06:30:00Z', '2026-10-04', '2026-10-04'], // Sun 23:30 LA, Monday in UTC: still this weekend
    ['2026-10-05T07:00:00Z', '2026-10-09', '2026-10-11'] // Mon 00:00 LA
  ])('Los Angeles %s → %s..%s', (now, from, to) => {
    expect(weekendWindow(new Date(now), 'America/Los_Angeles')).toEqual({ from, to })
  })

  it('keeps the cache until 23:59 local on Sunday', () => {
    const now = new Date('2026-09-28T09:00:00Z')
    // Sun 4 Oct 23:59 PDT = Mon 06:59Z; Sun 4 Oct 23:59 AEDT = Sun 12:59Z
    expect(weekendTtl({ to: '2026-10-04' }, now, 'America/Los_Angeles')).toBe((Date.parse('2026-10-05T06:59:00Z') - now.getTime()) / 1000)
    expect(weekendTtl({ to: '2026-10-04' }, now, 'Australia/Sydney')).toBe((Date.parse('2026-10-04T12:59:00Z') - now.getTime()) / 1000)
  })

  it('hides a finished Sunday event by LA time, not UK time', () => {
    const window = { from: '2026-10-02', to: '2026-10-04' }
    const events = { events: [ev('Brunch', '2026-10-04', '10:00:00'), ev('Late show', '2026-10-04', '21:00:00')] }
    // Sun 19:00 PDT: brunch is over, the late show is not (in London it's already Monday 03:00)
    const now = new Date('2026-10-05T02:00:00Z')
    expect(pickWeekendEvents(events, window, 5, now, 'America/Los_Angeles').map(e => e.name)).toEqual(['Late show'])
  })

  it('asks Ticketmaster for a US city in its own country and weekend', async () => {
    const proxy = vi.fn(async (req, res) => res.status(200).json(tm([ev('Dodgers', '2026-10-04', '13:00:00')])))
    // Thu 23:59 in LA is already Friday in London; the window is still the coming Fri-Sun
    const out = await weekendEvents({ countryCode: 'us', slug: 'los-angeles', lat: 34.05, lng: -118.24 }, 'ip', proxy, { now: new Date('2026-10-02T06:59:00Z') })
    expect(out.map(e => e.name)).toEqual(['Dodgers'])
    // Fri 00:00 PDT = 07:00Z; Sun 23:59:59 PDT = Mon 06:59:59Z
    expect(proxy.mock.calls[0][0].query).toMatchObject({ country: 'US', start: '2026-10-02T07:00:00Z', end: '2026-10-05T06:59:59Z' })
  })

  it('Hong Kong (its own country code, not Ticketmaster-covered) gets no events', async () => {
    const proxy = vi.fn()
    expect(await weekendEvents({ countryCode: 'hk', slug: 'hong-kong', lat: 22.28, lng: 114.16 }, 'ip', proxy)).toEqual([])
    expect(proxy).not.toHaveBeenCalled()
  })

  it.each(['ie', 'us', 'ca', 'au', 'nz'])('%s towns get events', async cc => {
    const proxy = vi.fn(async (req, res) => res.status(200).json(tm([])))
    expect(await weekendEvents({ countryCode: cc, slug: 'x', lat: 0, lng: 0 }, 'ip', proxy)).toEqual([])
    expect(proxy).toHaveBeenCalledTimes(1)
  })
})

describe('weekendWindow across the date line (regression: Auckland Fri gave Sat-Mon)', () => {
  const AKL = 'Pacific/Auckland'
  it.each([
    // June: NZST, UTC+12
    ['2026-06-18T11:59:00Z', '2026-06-19', '2026-06-21'], // Thu 23:59
    ['2026-06-18T12:30:00Z', '2026-06-19', '2026-06-21'], // Fri 00:30
    ['2026-06-19T12:30:00Z', '2026-06-20', '2026-06-21'], // Sat 00:30
    ['2026-06-20T23:00:00Z', '2026-06-21', '2026-06-21'], // Sun 11:00
    ['2026-06-21T12:30:00Z', '2026-06-26', '2026-06-28'], // Mon 00:30: the coming weekend, not the one after
    // Clocks go forward Sun 27 Sep 2026 02:00 (UTC+12 → +13)
    ['2026-09-25T11:30:00Z', '2026-09-25', '2026-09-27'], // Fri 23:30 NZST
    ['2026-09-26T13:00:00Z', '2026-09-27', '2026-09-27'], // Sun 01:00 NZST, an hour before the change
    ['2026-09-27T11:30:00Z', '2026-10-02', '2026-10-04'], // Mon 00:30 NZDT
    // Clocks go back Sun 5 Apr 2026 03:00 (UTC+13 → +12)
    ['2026-04-04T11:30:00Z', '2026-04-05', '2026-04-05'] // Sun 00:30 NZDT
  ])('Auckland %s → %s..%s', (now, from, to) => {
    expect(weekendWindow(new Date(now), AKL)).toEqual({ from, to })
  })

  it.each([
    ['Pacific/Honolulu', '2026-10-03T09:59:00Z', '2026-10-02', '2026-10-04'], // Fri 23:59 HST
    ['Pacific/Honolulu', '2026-10-05T09:30:00Z', '2026-10-04', '2026-10-04'], // Sun 23:30 HST, Monday in UTC
    ['Australia/Sydney', '2026-10-01T14:00:00Z', '2026-10-02', '2026-10-04'],
    ['America/Los_Angeles', '2026-10-05T06:30:00Z', '2026-10-04', '2026-10-04'],
    ['Europe/London', '2026-10-04T22:00:00Z', '2026-10-04', '2026-10-04']
  ])('%s %s → %s..%s', (tz, now, from, to) => {
    expect(weekendWindow(new Date(now), tz)).toEqual({ from, to })
  })
})

describe('weekendQueryRange: exact UTC bounds of the local weekend', () => {
  it.each([
    ['Pacific/Auckland', '2026-06-19', '2026-06-21', '2026-06-18T12:00:00Z', '2026-06-21T11:59:59Z'],
    // DST starts on the Sunday: Fri/Sat NZST (+12), Sunday night NZDT (+13)
    ['Pacific/Auckland', '2026-09-25', '2026-09-27', '2026-09-24T12:00:00Z', '2026-09-27T10:59:59Z'],
    ['Australia/Sydney', '2026-10-02', '2026-10-04', '2026-10-01T14:00:00Z', '2026-10-04T12:59:59Z'],
    ['America/Los_Angeles', '2026-10-02', '2026-10-04', '2026-10-02T07:00:00Z', '2026-10-05T06:59:59Z'],
    // Clocks go back Sun 25 Oct: Friday starts in BST, Sunday ends in GMT
    ['Europe/London', '2026-10-23', '2026-10-25', '2026-10-22T23:00:00Z', '2026-10-25T23:59:59Z']
  ])('%s %s..%s', (tz, from, to, start, end) => {
    expect(weekendQueryRange({ from, to }, new Date('2026-01-01T00:00:00Z'), tz)).toEqual({ start, end })
  })
  it('starts 3h ago, not Friday midnight, once the weekend is under way', () => {
    const now = new Date('2026-10-03T20:00:00Z') // Sat 13:00 PDT
    expect(weekendQueryRange({ from: '2026-10-03', to: '2026-10-04' }, now, 'America/Los_Angeles').start).toBe('2026-10-03T17:00:00Z')
  })
})
