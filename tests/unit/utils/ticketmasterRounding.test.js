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
