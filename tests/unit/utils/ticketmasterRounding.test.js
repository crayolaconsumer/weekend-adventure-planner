import process from 'node:process'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { roundCoord } from '../../../api/events/ticketmaster.js'

// The app must send the proxy's own ~1 km cell, or every request pays a 308 hop
describe('Ticketmaster client rounding', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests already-rounded coordinates that the proxy serves without a redirect', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ events: [], pagination: null }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchTicketmasterEvents } = await import('../../../src/utils/ticketmasterApi.js')
    const [lat, lng] = [51.507351, -0.127758]
    await fetchTicketmasterEvents(lat, lng, 30, { pagesToFetch: 1 })
    const sent = new URL(fetchMock.mock.calls[0][0], 'https://x').searchParams
    expect(sent.get('lat')).toBe('51.51')
    expect(sent.get('lng')).toBe('-0.13')
    // the exact strings the proxy compares against
    expect(sent.get('lat')).toBe(String(roundCoord(lat)))
    expect(sent.get('lng')).toBe(String(roundCoord(lng)))
  })
})

// The app is used worldwide: a date filter means the user's own calendar day, sent
// as exact UTC instants (local midnight to 23:59:59), never a UK day
describe('Ticketmaster client date range', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('in Sydney, "today" is Sydney midnight to 23:59:59 local, as UTC instants', async () => {
    const tz = process.env.TZ
    process.env.TZ = 'Australia/Sydney'
    try {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ events: [], pagination: null }) }))
      vi.stubGlobal('fetch', fetchMock)
      const { fetchTicketmasterEvents } = await import('../../../src/utils/ticketmasterApi.js')
      await fetchTicketmasterEvents(-33.87, 151.21, 30, { pagesToFetch: 1, from: '2026-10-27', to: '2026-10-27' })
      const sent = new URL(fetchMock.mock.calls[0][0], 'https://x').searchParams
      expect(sent.get('start')).toBe('2026-10-26T13:00:00Z') // 00:00 AEDT (UTC+11)
      expect(sent.get('end')).toBe('2026-10-27T12:59:59Z')
      expect(sent.has('from')).toBe(false)
    } finally {
      process.env.TZ = tz
    }
  })
})
