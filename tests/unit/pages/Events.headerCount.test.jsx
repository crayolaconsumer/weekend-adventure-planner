import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EVENTS_PAGE_SIZE } from '../../../src/pages/Events/constants'

const soon = () => ({ start: new Date(Date.now() + 86400000), allDay: false })
const total = EVENTS_PAGE_SIZE + 7
const events = Array.from({ length: total }, (_, i) => ({
  id: `e${i}`, name: `Gig ${i}`, source: 'ticketmaster', datetime: soon(), venue: { name: 'Hall' }, pricing: { isFree: false },
}))
vi.mock('../../../src/utils/eventsApi', async (orig) => ({
  ...(await orig()),
  fetchAllEvents: vi.fn(async () => ({ events, hasMore: false, totalAvailable: total, currentPage: 3 })),
}))
vi.mock('../../../src/hooks/useSavedEvents', () => ({
  useSavedEvents: () => ({ events: [], saveEvent: vi.fn(), unsaveEvent: vi.fn(), isEventSaved: () => false }),
}))

const { default: Events } = await import('../../../src/pages/Events')

describe('Events header count', () => {
  it('counts every matching event, not just the first page', async () => {
    render(<MemoryRouter><Events location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    expect(await screen.findByText(`${total} events near you`)).toBeInTheDocument()
  })
})
