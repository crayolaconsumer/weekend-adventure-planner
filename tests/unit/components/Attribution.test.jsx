import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const openExternalLink = vi.fn()
vi.mock('../../../src/utils/navigation', () => ({
  openExternalLink: (...a) => openExternalLink(...a),
  openDirections: vi.fn(),
}))

// PlaceDetail's heavy children, as in PlaceDetail.order.test.jsx
vi.mock('../../../src/utils/apiClient', () => ({ enrichPlace: vi.fn(async p => p) }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }))
vi.mock('../../../src/hooks/useVisitedPlaces', () => ({ useVisitedPlaces: () => ({ visitedPlaces: [] }) }))
vi.mock('../../../src/utils/imageCache', () => ({
  fetchAndCacheImage: vi.fn(async () => null), getCachedImage: vi.fn(async () => null), invalidateCachedImage: vi.fn(async () => {})
}))
vi.mock('../../../src/components/GooglePlaceCard', () => ({ default: () => null }))
vi.mock('../../../src/components/PlaceReviews', () => ({ default: () => null }))
vi.mock('../../../src/components/SocialProof', () => ({ default: () => null }))
vi.mock('../../../src/components/PlaceBadges', () => ({ default: () => null }))
vi.mock('../../../src/components/ShareButton', () => ({ default: () => null }))
vi.mock('../../../src/components/CollectionManager', () => ({ default: () => null }))
vi.mock('../../../src/components/PlanVisitSheet', () => ({ default: () => null }))
vi.mock('../../../src/components/ContributionDisplay', () => ({ ContributionList: () => null, ContributionBadge: () => null }))
vi.mock('../../../src/components/ContributionPrompt', () => ({ default: () => null }))
// Exposes the credit slot PlaceDetail asks the fallback image for
vi.mock('../../../src/components/PlaceImage', () => ({ default: (p) => p.creditClassName ? <i data-testid="fallback-credit" className={p.creditClassName} /> : null }))
vi.mock('../../../src/components/FriendChips', () => ({ default: () => null }))
vi.mock('../../../src/hooks/useContributions', () => ({ useContributions: () => ({ contributions: [], loading: false, refresh: vi.fn() }) }))
vi.mock('../../../src/hooks/useNearViewport', () => ({ useNearViewport: () => false }))
vi.mock('../../../src/hooks/useSavedPlaces', () => ({ useSavedPlaces: () => ({ updatePlannedDate: vi.fn() }) }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => km => `${km}km` }))
vi.mock('../../../src/contexts/ThemeContext', () => ({ useTheme: () => ({ resolved: 'light' }) }))
vi.mock('../../../src/utils/placeImage', () => ({ fetchWikipediaSummary: vi.fn(async () => null), isWikiExcerpt: () => false }))

const { OsmDataCredit, PhotoCredit, OSM_COPYRIGHT_URL } = await import('../../../src/components/Attribution')
const { default: PlaceDetail } = await import('../../../src/components/PlaceDetail.jsx')
const { default: SwipeCard } = await import('../../../src/components/SwipeCard.jsx')
const { default: Terms } = await import('../../../src/pages/Terms.jsx')

const COMMONS = {
  name: 'Tower_of_London.jpg',
  url: 'https://commons.wikimedia.org/wiki/File:Tower_of_London.jpg',
  source: 'Wikimedia Commons',
  artist: 'Jane Doe',
  license: 'CC BY-SA 4.0',
}
const place = { id: 'p1', name: 'Tower of London', type: 'castle', lat: 51.508, lng: -0.076, image: 'https://img.test/tower.jpg' }

beforeEach(() => openExternalLink.mockReset())

describe('photo credit text', () => {
  const text = attr => render(<PhotoCredit attribution={attr} />).container.textContent
  it('names the artist and licence', () => {
    expect(text(COMMONS)).toBe('Photo: Jane Doe, CC BY-SA 4.0')
  })
  it('falls back to the source when the artist is unknown, and drops a missing licence', () => {
    expect(text({ source: 'Mapillary' })).toBe('Photo: Mapillary')
  })
  it('renders nothing with nothing to credit', () => {
    expect(text(null)).toBe('')
    expect(text({ name: 'x.jpg' })).toBe('')
  })
})

describe('PhotoCredit', () => {
  it('links to the photo page and opens it in the in-app browser', () => {
    render(<PhotoCredit attribution={COMMONS} />)
    const link = screen.getByRole('link', { name: 'Photo: Jane Doe, CC BY-SA 4.0' })
    expect(link).toHaveAttribute('href', COMMONS.url)
    fireEvent.click(link)
    expect(openExternalLink).toHaveBeenCalledWith(COMMONS.url)
  })
  it('uses page_url (the planned photo field) and plain text for a non-http url', () => {
    const { rerender } = render(<PhotoCredit attribution={{ artist: 'A', license: 'CC BY 2.0', page_url: 'https://geograph.test/1' }} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://geograph.test/1')
    rerender(<PhotoCredit attribution={{ source: 'X', url: 'javascript:alert(1)' }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Photo: X')).toBeInTheDocument()
  })
})

describe('OsmDataCredit', () => {
  it('credits OpenStreetMap contributors with the copyright link', () => {
    render(<OsmDataCredit />)
    expect(screen.getByText(/Place data ©/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute('href', OSM_COPYRIGHT_URL)
  })
})

describe('PlaceDetail credits', () => {
  const renderDetail = p => render(<MemoryRouter><PlaceDetail place={p} onClose={() => {}} variant="page" /></MemoryRouter>)

  it('shows the photo credit over the hero and the OSM data credit', () => {
    const { container } = renderDetail({ ...place, imageAttribution: COMMONS })
    const credit = screen.getByRole('link', { name: 'Photo: Jane Doe, CC BY-SA 4.0' })
    expect(container.querySelector('.place-detail-hero').contains(credit)).toBe(true)
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute('href', OSM_COPYRIGHT_URL)
  })
  it('asks the fallback PlaceImage (async Wikipedia/Commons photo) for a credit', () => {
    renderDetail({ ...place, image: undefined })
    expect(screen.getByTestId('fallback-credit')).toHaveClass('place-detail-photo-credit')
  })
  it('has no photo credit without an attribution', () => {
    renderDetail(place)
    expect(screen.queryByText(/^Photo:/)).toBeNull()
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeInTheDocument()
  })
})

describe('SwipeCard photo credit', () => {
  const renderCard = (p, props = {}) => render(<MemoryRouter><SwipeCard place={p} onSwipe={() => {}} isTop {...props} /></MemoryRouter>)

  it('Enter on the credit link follows the link, not the card', () => {
    const onExpand = vi.fn()
    renderCard({ ...place, imageAttribution: COMMONS }, { onExpand })
    fireEvent.keyDown(screen.getByRole('link', { name: /^Photo:/ }), { key: 'Enter' })
    expect(onExpand).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' })
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
  it('keeps the credit link out of the tab order on cards under the top one', () => {
    const { unmount } = renderCard({ ...place, imageAttribution: COMMONS }, { isTop: false })
    expect(screen.getByRole('link', { name: /^Photo:/ })).toHaveAttribute('tabindex', '-1')
    unmount()
    renderCard({ ...place, imageAttribution: COMMONS })
    expect(screen.getByRole('link', { name: /^Photo:/ })).not.toHaveAttribute('tabindex')
  })

  it('shows no credit without an attribution, or without a real photo', () => {
    const { unmount } = renderCard(place)
    expect(screen.queryByText(/^Photo:/)).toBeNull()
    unmount()
    renderCard({ ...place, image: undefined, imageAttribution: COMMONS })
    expect(screen.queryByText(/^Photo:/)).toBeNull()
  })
})

describe('Terms', () => {
  it('says the data is OpenStreetMap under ODbL and links the published database', () => {
    render(<Terms />)
    expect(screen.getByText(/derives from/)).toHaveTextContent(/Open Database License \(ODbL\)/)
    expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', OSM_COPYRIGHT_URL)
    expect(screen.getByRole('link', { name: /weekend-adventure-planner\/releases/ }))
      .toHaveAttribute('href', 'https://github.com/crayolaconsumer/weekend-adventure-planner/releases')
  })
})
