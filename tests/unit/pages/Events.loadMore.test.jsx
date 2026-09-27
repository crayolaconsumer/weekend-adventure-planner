import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const soon = () => ({ start: new Date(Date.now() + 86400000), allDay: false })
const event = (id) => ({ id, name: `Gig ${id}`, category: 'music', source: 'ticketmaster', datetime: soon(), venue: { name: 'Hall' }, pricing: { isFree: false } })

// First page claims more are on the server; the next page comes back empty.
const fetchAllEvents = vi.fn(async () => ({ events: [event('a')], hasMore: true, totalAvailable: 50, currentPage: 3 }))
const fetchMoreEvents = vi.fn(async () => ({ events: [], hasMore: true, totalAvailable: 50, currentPage: 6 }))
vi.mock('../../../src/utils/eventsApi', async (orig) => ({
  ...(await orig()),
  fetchAllEvents: (...a) => fetchAllEvents(...a),
  fetchMoreEvents: (...a) => fetchMoreEvents(...a),
}))
vi.mock('../../../src/hooks/useSavedEvents', () => ({
  useSavedEvents: () => ({ events: [], saveEvent: vi.fn(), unsaveEvent: vi.fn(), isEventSaved: () => false }),
}))

const { default: Events } = await import('../../../src/pages/Events')

describe('Events load more', () => {
  it('hides "Load more events" once the server has nothing left', async () => {
    render(<MemoryRouter><Events location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    const btn = await screen.findByRole('button', { name: 'Load more events' })
    await userEvent.click(btn)
    await waitFor(() => expect(fetchMoreEvents).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: /load more/i })).toBeNull())
  })
})
