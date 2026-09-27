import { describe, it, expect, vi } from 'vitest'

const future = d => ({ start: new Date(Date.now() + d * 86400000), allDay: false })
const tm = [
  { id: 'a', name: 'GIFT CARD REDEMPTION', datetime: future(1), venue: {}, source: 'ticketmaster' },
  { id: 'b', name: 'SOLD OUT SHOW', isSoldOut: true, score: 100, datetime: future(1), venue: {}, source: 'ticketmaster' },
  { id: 'c', name: 'I LOVE REGGAETON', datetime: future(2), venue: {}, source: 'ticketmaster' },
]
vi.mock('../../../src/utils/ticketmasterApi', () => ({ fetchTicketmasterEvents: vi.fn(async () => ({ events: tm, pagination: null })) }))
vi.mock('../../../src/utils/skiddleApi', () => ({ fetchSkiddleEvents: vi.fn(async () => []) }))
vi.mock('../../../src/utils/promotedEventsApi', () => ({ fetchPromotedEvents: vi.fn(async () => []) }))

const { fetchAllEvents } = await import('../../../src/utils/eventsApi.js')

describe('fetchAllEvents tidying', () => {
  it('drops non-events, tidies caps titles and lists sold-out last', async () => {
    const { events } = await fetchAllEvents(51.5, -0.12, 30)
    expect(events.map(e => e.name)).toEqual(['I Love Reggaeton', 'Sold Out Show'])
  })
})
