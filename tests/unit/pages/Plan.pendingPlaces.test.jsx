import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../../../src/hooks/useRouting', () => ({ useRouting: () => ({ getTravelTime: vi.fn(async () => null) }) }))
vi.mock('../../../src/hooks/useSavedPlaces', () => ({ useSavedPlaces: () => ({ places: [] }) }))
vi.mock('../../../src/utils/apiClient', () => ({ fetchEnrichedPlaces: vi.fn(async () => []) }))
vi.mock('../../../src/components/plan/ShareModal', () => ({ default: () => null }))
vi.mock('../../../src/components/plan/MiniMapRibbon', () => ({ default: () => null }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => (km) => `${km} km` }))
vi.mock('../../../src/components/PlaceDetail', () => ({ default: () => null }))

const { default: Plan } = await import('../../../src/pages/Plan')
const apiClient = await import('../../../src/utils/apiClient')

const cafe = { id: 'p1', name: 'Pending Cafe', lat: 51.5, lng: -0.12, category: { key: 'food', label: 'Cafe' } }

describe('Plan pending places from Discover', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('adds the queued place to the itinerary, then clears the queue', async () => {
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    expect((await screen.findAllByText('Pending Cafe')).length).toBeGreaterThan(0)
    expect(localStorage.getItem('roam_pending_plan_place')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Added Pending Cafe')
  })

  it('a corrupt queue is dropped without crashing', () => {
    localStorage.setItem('roam_pending_plan_place', '{bad')
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    expect(localStorage.getItem('roam_pending_plan_place')).toBeNull()
  })

  it('shows a Plan page title', () => {
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument()
  })
})

describe('Plan generate and draft', () => {
  const museum = { id: 'm1', name: 'The Town Museum', type: 'museum', lat: 51.503, lng: -0.12 }

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('Generate keeps the stops the user added', async () => {
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    apiClient.fetchEnrichedPlaces.mockResolvedValueOnce([museum])
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    fireEvent.click(screen.getByRole('button', { name: 'Generate itinerary' }))
    expect((await screen.findAllByText('The Town Museum')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pending Cafe').length).toBeGreaterThan(0)
    // walking plans search 2 km, not the 10 km "Local" radius
    expect(apiClient.fetchEnrichedPlaces).toHaveBeenCalledWith(51.5, -0.12, 2000, null)
  })

  it('restores the draft plan after leaving the page', async () => {
    const first = render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    first.unmount()
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('roam_plan_draft')).itinerary[0].id).toBe('p1'))

    const again = render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    expect(again.getAllByText('Pending Cafe').length).toBeGreaterThan(0)
  })

  it('clears the draft once the plan is saved to an account', async () => {
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    fetch.mockImplementation(async (url, opts) => (url === '/api/plans' && opts?.method === 'POST'
      ? new Response(JSON.stringify({ plan: { shareCode: 'abc' } }), { status: 200 })
      : new Response('{}', { status: 404 })))
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    await waitFor(() => expect(localStorage.getItem('roam_plan_draft')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(localStorage.getItem('roam_plan_draft')).toBeNull())
  })
})
