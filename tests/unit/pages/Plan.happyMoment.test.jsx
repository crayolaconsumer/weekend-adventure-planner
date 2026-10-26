import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn() }
const recordHappyMoment = vi.fn()
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../../../src/hooks/useRouting', () => ({ useRouting: () => ({ getTravelTime: vi.fn(async () => null) }) }))
vi.mock('../../../src/hooks/useSavedPlaces', () => ({ useSavedPlaces: () => ({ places: [] }) }))
const fetchEnrichedPlaces = vi.fn(async () => [])
vi.mock('../../../src/utils/apiClient', () => ({ fetchEnrichedPlaces: (...a) => fetchEnrichedPlaces(...a) }))
vi.mock('../../../src/components/plan/ShareModal', () => ({ default: () => null }))
vi.mock('../../../src/components/plan/MiniMapRibbon', () => ({ default: () => null }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => (km) => `${km} km` }))
vi.mock('../../../src/components/PlaceDetail', () => ({ default: () => null }))
vi.mock('../../../src/utils/reviewPrompt', () => ({ recordHappyMoment: (...a) => recordHappyMoment(...a) }))

const { default: Plan } = await import('../../../src/pages/Plan')

const cafe = { id: 'p1', name: 'Pending Cafe', lat: 51.5, lng: -0.12, category: { key: 'food', label: 'Cafe' } }
let postStatus

describe('Plan save records a plan_saved happy moment', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => opts.method === 'POST' && url === '/api/plans'
      ? new Response(JSON.stringify({ plan: { shareCode: 'abc' } }), { status: postStatus })
      : new Response('{}', { status: 404 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function saveWith(status) {
    postStatus = status
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.success.mock.calls.length + toast.error.mock.calls.length).toBeGreaterThan(1))
  }

  it('once when the server saves it', async () => {
    await saveWith(200)
    expect(toast.success).toHaveBeenCalledWith('Saved! Ready to share.')
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
    expect(recordHappyMoment).toHaveBeenCalledWith('plan_saved')
  })

  it('once when saved locally (signed out)', async () => {
    await saveWith(401)
    expect(toast.success).toHaveBeenCalledWith('Saved locally! Sign in to share.')
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })

  it('never when the save fails', async () => {
    await saveWith(500)
    expect(toast.error).toHaveBeenCalledWith('Failed to save')
    expect(recordHappyMoment).not.toHaveBeenCalled()
  })
})

describe('Plan: a plan counts once', () => {
  const stopData = { id: 'p1', name: 'Pending Cafe', lat: 51.5, lng: -0.12, category: { key: 'food', label: 'Cafe' } }
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })
  afterEach(() => vi.unstubAllGlobals())

  it('reopening a saved plan (?planId) and saving it is an edit: no moment', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if (opts.method === 'POST' && url === '/api/plans') return new Response(JSON.stringify({ plan: { shareCode: 'new' } }), { status: 200 })
      if (String(url).startsWith('/api/plans/7')) return new Response(JSON.stringify({ plan: { shareCode: 'old', vibe: 'mix', durationHours: 3, stops: [{ placeId: 'p1', placeData: stopData, scheduledTime: '10:00:00', durationMinutes: 60 }] } }), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
    render(<MemoryRouter initialEntries={['/plan?planId=7']}><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(recordHappyMoment).not.toHaveBeenCalled()
  })

  it('pressing Save again on the same plan: one moment total', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => (opts.method === 'POST' && url === '/api/plans'
      ? new Response(JSON.stringify({ plan: { shareCode: 'abc' } }), { status: 200 }) : new Response('{}', { status: 404 }))))
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([stopData]))
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(3))
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })

  it('signed out: saving the same plan twice locally is one moment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([stopData]))
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.success.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })
})

describe('Plan: a newly generated plan counts again', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })
  afterEach(() => vi.unstubAllGlobals())

  it('save, generate a new plan, save it: two moments', async () => {
    let code = 0
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => (opts.method === 'POST' && url === '/api/plans'
      ? new Response(JSON.stringify({ plan: { shareCode: `c${++code}` } }), { status: 200 }) : new Response('{}', { status: 404 }))))
    const types = ['museum', 'park', 'cafe', 'castle', 'gallery', 'garden']
    fetchEnrichedPlaces.mockResolvedValue(types.map((type, i) => ({
      id: `g${i}`, name: `Spot ${i}`, type, lat: 51.5 + i * 0.002, lng: -0.12, score: 80,
      category: { key: i % 2 ? 'nature' : 'culture', label: 'X' }, wikipedia: 'en:x', website: 'https://x',
    })))
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([{ id: 'p1', name: 'Pending Cafe', lat: 51.5, lng: -0.12, category: { key: 'food', label: 'Cafe' } }]))
    render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
    await screen.findAllByText('Pending Cafe')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(recordHappyMoment).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /generate itinerary/i }))
    await screen.findAllByText(/Spot \d/, {}, { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(recordHappyMoment).toHaveBeenCalledTimes(2))
  })
})

describe('Plan: signed out, the same plan across visits counts once', () => {
  const cafe = { id: 'p1', name: 'Pending Cafe', lat: 51.5, lng: -0.12, category: { key: 'food', label: 'Cafe' } }
  const pub = { id: 'p2', name: 'Pending Pub', lat: 51.501, lng: -0.121, category: { key: 'food', label: 'Pub' } }
  const mount = () => render(<MemoryRouter><Plan location={{ lat: 51.5, lng: -0.12 }} /></MemoryRouter>)
  async function saveOnce() {
    const n = toast.success.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(toast.success.mock.calls.length).toBeGreaterThan(n))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Save/ })).not.toBeDisabled())
  }
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 }))) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('save, leave Plan, come back (the draft restores it), save again: one moment', async () => {
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    mount(); await screen.findAllByText('Pending Cafe'); await saveOnce()
    cleanup()
    mount(); await screen.findAllByText('Pending Cafe'); await saveOnce()
    cleanup()
    mount(); await screen.findAllByText('Pending Cafe'); await saveOnce()
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })

  it('leaving while the save is in flight, then returning and saving: still one moment', async () => {
    let release
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { release = () => r(new Response('{}', { status: 401 })) })))
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    mount(); await screen.findAllByText('Pending Cafe')
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    cleanup() // a tab switch before the response lands
    release(); await new Promise(r => setTimeout(r, 20))
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    mount(); await screen.findAllByText('Pending Cafe'); await saveOnce()
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })

  it('a place added to the restored plan is an edit of the same plan: no new moment', async () => {
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([cafe]))
    mount(); await screen.findAllByText('Pending Cafe'); await saveOnce()
    cleanup()
    localStorage.setItem('roam_pending_plan_place', JSON.stringify([pub]))
    mount(); await screen.findAllByText('Pending Pub')
    expect(screen.getAllByText('Pending Cafe').length).toBeGreaterThan(0)
    await saveOnce()
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })
})
