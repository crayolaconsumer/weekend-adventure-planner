import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { appendStops } from '../../../src/pages/Plan/appendStops'

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

describe('appendStops', () => {
  it('starts at 10:00, spaces stops 2.5h apart and skips duplicates', () => {
    const a = appendStops([], [cafe, { ...cafe, id: 'p2' }, cafe], null)
    expect(a.map(s => s.id)).toEqual(['p1', 'p2'])
    expect(new Date(a[0].scheduledTime).getHours()).toBe(10)
    expect(new Date(a[1].scheduledTime) - new Date(a[0].scheduledTime)).toBe(150 * 60000)
    expect(a[0].duration).toBe(90)
  })
})
