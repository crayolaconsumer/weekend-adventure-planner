import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const place = {
  id: 'p1', name: 'Tower of London', type: 'castle', lat: 51.508, lng: -0.076,
  photo: 'https://img.test/tower.jpg', address: 'London EC3N 4AB', openingHours: 'Mo-Su 09:00-17:30',
  website: 'https://hrp.test',
}

vi.mock('../../../src/utils/apiClient', () => ({ enrichPlace: vi.fn(async p => p) }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }))
vi.mock('../../../src/hooks/useVisitedPlaces', () => ({ useVisitedPlaces: () => ({ visitedPlaces: [] }) }))
vi.mock('../../../src/utils/imageCache', () => ({
  fetchAndCacheImage: vi.fn(async () => null), getCachedImage: vi.fn(async () => null), invalidateCachedImage: vi.fn(async () => {})
}))
vi.mock('../../../src/components/PlaceReviews', () => ({ default: () => null }))
vi.mock('../../../src/components/SocialProof', () => ({ default: () => null }))
vi.mock('../../../src/components/PlaceBadges', () => ({ default: () => null }))
vi.mock('../../../src/components/ShareButton', () => ({ default: () => null }))
vi.mock('../../../src/components/CollectionManager', () => ({ default: () => null }))
vi.mock('../../../src/components/PlanVisitSheet', () => ({ default: () => null }))
vi.mock('../../../src/components/ContributionDisplay', () => ({ ContributionList: () => null }))
vi.mock('../../../src/components/ContributionPrompt', () => ({ default: () => null }))
vi.mock('../../../src/components/PlaceImage', () => ({ default: () => null }))
vi.mock('../../../src/hooks/useContributions', () => ({ useContributions: () => ({ contributions: [], loading: false, refresh: vi.fn() }) }))
// The map stays lazy: not near the viewport, so Leaflet never mounts
vi.mock('../../../src/hooks/useNearViewport', () => ({ useNearViewport: () => false }))
vi.mock('../../../src/hooks/useSavedPlaces', () => ({ useSavedPlaces: () => ({ updatePlannedDate: vi.fn() }) }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => km => `${km}km` }))
vi.mock('../../../src/contexts/ThemeContext', () => ({ useTheme: () => ({ resolved: 'light' }) }))
const geo = vi.hoisted(() => ({ getCurrentPosition: vi.fn(async () => { throw Object.assign(new Error('denied'), { code: 1 }) }) }))
vi.mock('../../../src/utils/nativePlugins', () => geo)
vi.mock('../../../src/utils/placeImage', () => ({ fetchWikipediaSummary: vi.fn(async () => null), isWikiExcerpt: () => false }))

const { default: PlaceDetail } = await import('../../../src/components/PlaceDetail.jsx')

// Regression: Discover passes its London fallback as userLocation when
// location is off; a route must never be drawn from it.
describe('PlaceDetail route origin', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ignores a passed-in (possibly fallback) location and asks the device; denied → explains, no route request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter><PlaceDetail place={place} onClose={() => {}} variant="page" userLocation={{ lat: 51.5074, lng: -0.1278, isFallback: true }} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Show route/ }))
    expect(await screen.findByText(/Turn on location to see a route/)).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/routing'))).toHaveLength(0)
  })

  it('uses a genuine device fix passed in, without asking the device again', async () => {
    geo.getCurrentPosition.mockClear()
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ duration: 9, distance: 0.7, source: 'api', geometry: [[51.49, -0.1], [51.508, -0.076]] }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter><PlaceDetail place={place} onClose={() => {}} variant="page" userLocation={{ lat: 51.49, lng: -0.1, fromDeviceFix: true }} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Show route/ }))
    expect(await screen.findByText(/9 min walk/)).toBeTruthy()
    expect(geo.getCurrentPosition).not.toHaveBeenCalled()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toEqual({ lat: 51.49, lng: -0.1 })
  })
})
