import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const fetchAllEvents = vi.fn(async () => ({ events: [], hasMore: false, totalAvailable: 0, currentPage: 3 }))
vi.mock('../../../src/utils/eventsApi', async (orig) => ({ ...(await orig()), fetchAllEvents: (...a) => fetchAllEvents(...a) }))
vi.mock('../../../src/hooks/useSavedEvents', () => ({
  useSavedEvents: () => ({ events: [], saveEvent: vi.fn(), unsaveEvent: vi.fn(), isEventSaved: () => false }),
}))

const { default: Events } = await import('../../../src/pages/Events')
const { eventsDateRange } = await import('../../../src/utils/eventsApi')

describe('Events date filters', () => {
  it('asks the server for the picked date range instead of filtering the first page', async () => {
    render(<MemoryRouter><Events location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await waitFor(() => expect(fetchAllEvents).toHaveBeenCalledTimes(1))
    expect(fetchAllEvents.mock.calls[0][3]).toEqual({})

    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    await waitFor(() => expect(fetchAllEvents).toHaveBeenCalledTimes(2))
    expect(fetchAllEvents.mock.calls[1][3]).toEqual(eventsDateRange('tomorrow'))
  })

  it('has no refresh button or "(N available)" count', async () => {
    render(<MemoryRouter><Events location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await waitFor(() => expect(fetchAllEvents).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /refresh events/i })).toBeNull()
    expect(screen.queryByText(/available\)/)).toBeNull()
  })
})
