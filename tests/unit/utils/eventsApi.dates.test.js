import { describe, it, expect, vi, afterEach } from 'vitest'
import { weekendWindow, eventsDateRange, getWeekendEvents, fetchAllEvents } from '../../../src/utils/eventsApi'

// 2026-10-03 is a Saturday (BST)
const at = iso => new Date(iso)
const ev = (id, iso) => ({ id, datetime: { start: new Date(iso) } })

describe('weekendWindow (UK calendar, matches api/lib/townEvents.js)', () => {
  it('Saturday: today until Sunday', () => {
    expect(weekendWindow(at('2026-10-03T10:00:00Z'))).toEqual({ from: '2026-10-03', to: '2026-10-04' })
  })
  it('Sunday: today only, not next weekend', () => {
    expect(weekendWindow(at('2026-10-04T10:00:00Z'))).toEqual({ from: '2026-10-04', to: '2026-10-04' })
  })
  it('Monday: the coming Friday to Sunday', () => {
    expect(weekendWindow(at('2026-10-05T10:00:00Z'))).toEqual({ from: '2026-10-09', to: '2026-10-11' })
  })
  it('uses UK dates: 23:30Z Saturday is already Sunday in BST', () => {
    expect(weekendWindow(at('2026-10-03T23:30:00Z'))).toEqual({ from: '2026-10-04', to: '2026-10-04' })
  })
})

describe('getWeekendEvents', () => {
  const events = [
    ev('sat', '2026-10-03T19:00:00Z'),
    ev('sun', '2026-10-04T19:00:00Z'),
    ev('nextSat', '2026-10-10T19:00:00Z'),
    { id: 'nodate', datetime: {} },
  ]
  it('on a Sunday returns Sunday events (was empty: jumped to next Saturday)', () => {
    expect(getWeekendEvents(events, at('2026-10-04T09:00:00Z')).map(e => e.id)).toEqual(['sun'])
  })
  it('on a Saturday returns Saturday and Sunday', () => {
    expect(getWeekendEvents(events, at('2026-10-03T09:00:00Z')).map(e => e.id)).toEqual(['sat', 'sun'])
  })
  it('on a Monday returns the coming weekend', () => {
    expect(getWeekendEvents(events, at('2026-10-05T09:00:00Z')).map(e => e.id)).toEqual(['nextSat'])
  })
})

describe('eventsDateRange', () => {
  const now = at('2026-10-05T10:00:00Z') // Monday
  it('maps date chips to UK date ranges', () => {
    expect(eventsDateRange('today', now)).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(eventsDateRange('tomorrow', now)).toEqual({ from: '2026-10-06', to: '2026-10-06' })
    expect(eventsDateRange('weekend', now)).toEqual({ from: '2026-10-09', to: '2026-10-11' })
    expect(eventsDateRange('week', now)).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(eventsDateRange('month', now)).toEqual({ from: '2026-10-05', to: '2026-11-03' })
  })
  it('non-date chips send no range', () => {
    expect(eventsDateRange('all', now)).toBeNull()
    expect(eventsDateRange('free', now)).toBeNull()
  })
})

describe('fetchAllEvents date range', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends from/to to the Ticketmaster proxy', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchAllEvents(51.5, -0.12, 25, { from: '2026-10-06', to: '2026-10-06' })
    const tm = fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('/api/events/ticketmaster'))
    expect(tm.length).toBeGreaterThan(0)
    for (const url of tm) {
      const q = new URL(url, 'http://x').searchParams
      expect(q.get('from')).toBe('2026-10-06')
      expect(q.get('to')).toBe('2026-10-06')
    }
  })
})
