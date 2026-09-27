import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
vi.mock('../../../src/utils/placeImage', () => ({ fetchWikipediaSummary: vi.fn(async () => null), isWikiExcerpt: () => false }))

const { default: PlaceDetail } = await import('../../../src/components/PlaceDetail.jsx')

const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe.each(['modal', 'page'])('PlaceDetail %s: the photo leads, the map follows the key info', (variant) => {
  it('orders photo, title, hours and actions before the map', () => {
    const { container } = render(<MemoryRouter><PlaceDetail place={place} onClose={() => {}} variant={variant} /></MemoryRouter>)
    const hero = container.querySelector('.place-detail-hero')
    const title = screen.getByRole('heading', { level: 1, name: 'Tower of London' })
    const hours = screen.getByRole('heading', { name: /Opening hours/ })
    const actions = container.querySelector('.place-detail-actions')
    const map = container.querySelector('.place-detail-map')

    expect(map).not.toBeNull()
    expect(follows(hero, title)).toBe(true)
    expect(follows(title, map)).toBe(true)
    expect(follows(hours, map)).toBe(true)
    expect(follows(actions, map)).toBe(true)
    // Lazy mount kept: no Leaflet until the box is near the viewport
    expect(container.querySelector('.place-detail-map-leaflet')).toBeNull()
  })
})
