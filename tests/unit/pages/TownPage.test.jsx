import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const fetchNearbyPlaces = vi.fn()
const getCurrentPosition = vi.fn()
const shareContent = vi.fn()
vi.mock('../../../src/utils/apiClient', () => ({ fetchNearbyPlaces: (...a) => fetchNearbyPlaces(...a) }))
vi.mock('../../../src/utils/nativePlugins', () => ({ getCurrentPosition: (...a) => getCurrentPosition(...a) }))
vi.mock('../../../src/utils/shareCard', () => ({ shareContent: (...a) => shareContent(...a) }))
vi.mock('../../../src/components/PlaceImage', () => ({ default: () => null }))
vi.mock('../../../src/components/PlaceDetail', () => ({ default: () => null }))
vi.mock('../../../src/pages/NotFound', () => ({ default: () => <p>Not found page</p> }))

const { default: TownPage } = await import('../../../src/pages/TownPage')

const PARIS = { slug: 'paris', name: 'Paris', region: 'Ile-de-France', country: 'France', lat: 48.8589, lng: 2.32, blurb: null }
const HATFIELD = { slug: 'hatfield', name: 'Hatfield', region: 'Hertfordshire', country: 'United Kingdom', lat: 51.7635, lng: -0.2259, blurb: 'Hatfield House and its park.' }

function mockApi(routes) {
  globalThis.fetch = vi.fn(async url => {
    const key = Object.keys(routes).find(k => url.includes(k))
    if (!key) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ town: routes[key] }) }
  })
}

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/town/:slug" element={<><TownPage /><Where /></>} /></Routes>
    </MemoryRouter>
  )
}

const realFetch = globalThis.fetch
beforeEach(() => {
  vi.clearAllMocks()
  fetchNearbyPlaces.mockResolvedValue([
    { id: 1, name: 'Jardin du Luxembourg', type: 'garden', qualityScore: 5 },
    { id: 2, name: 'Café de Flore', type: 'cafe', qualityScore: 9 }
  ])
})
afterEach(() => { globalThis.fetch = realFetch })

describe('TownPage', () => {
  it('works for any town, not just a hardcoded list', async () => {
    mockApi({ 'slug=paris': PARIS })
    renderAt('/town/paris')
    expect(await screen.findByRole('heading', { name: 'Paris' })).toBeInTheDocument()
    expect(screen.getByText('Ile-de-France, France')).toBeInTheDocument()
    // places load around the geocoded centre, best first
    await waitFor(() => expect(fetchNearbyPlaces).toHaveBeenCalledWith(48.8589, 2.32, 3300))
    const names = (await screen.findAllByText(/Café de Flore|Jardin du Luxembourg/)).map(n => n.textContent)
    expect(names).toEqual(['Café de Flore', 'Jardin du Luxembourg'])
  })

  it('near-me resolves device GPS to the real town URL', async () => {
    getCurrentPosition.mockResolvedValue({ coords: { latitude: 51.76412, longitude: -0.22591 } })
    mockApi({ 'near=51.7641,-0.2259': HATFIELD, 'slug=hatfield': HATFIELD })
    renderAt('/town/near-me')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/town/hatfield'))
    expect(await screen.findByRole('heading', { name: 'Hatfield' })).toBeInTheDocument()
    expect(screen.getByText('Hatfield House and its park.')).toBeInTheDocument()
  })

  it('near-me explains a denied location instead of hanging', async () => {
    getCurrentPosition.mockRejectedValue(new Error('denied'))
    renderAt('/town/near-me')
    expect(await screen.findByText(/Couldn't get your location/)).toBeInTheDocument()
  })

  it('near-me with location granted but the server down says so, not "allow location"', async () => {
    getCurrentPosition.mockResolvedValue({ coords: { latitude: 51.7, longitude: -0.2 } })
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    renderAt('/town/near-me')
    expect(await screen.findByText(/Couldn't load places/)).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't get your location/)).toBeNull()
  })

  it('near-me in the middle of nowhere explains itself instead of a 404', async () => {
    getCurrentPosition.mockResolvedValue({ coords: { latitude: 0, longitude: -30 } })
    mockApi({})
    renderAt('/town/near-me')
    expect(await screen.findByText('No town found here')).toBeInTheDocument()
    expect(screen.queryByText('Not found page')).toBeNull()
  })

  it('a town with no places says so, rather than blaming the connection', async () => {
    fetchNearbyPlaces.mockResolvedValue([])
    mockApi({ 'slug=paris': PARIS })
    renderAt('/town/paris')
    expect(await screen.findByText('Nothing listed here yet')).toBeInTheDocument()
    expect(screen.queryByText(/Check your connection/)).toBeNull()
  })

  it('replaces a typo with the canonical slug', async () => {
    mockApi({ 'slug=hatfeild': HATFIELD, 'slug=hatfield': HATFIELD })
    renderAt('/town/hatfeild')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/town/hatfield'))
  })

  it('follows at most one alias redirect, and still loads the page (regression guard)', async () => {
    // A stale cache says aa → bb and bb → aa
    globalThis.fetch = vi.fn(async url => ({
      ok: true, status: 200,
      json: async () => ({ town: { ...PARIS, slug: url.includes('slug=aa') ? 'bb' : 'aa' } })
    }))
    renderAt('/town/aa')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/town/bb'))
    expect(await screen.findByText('Café de Flore')).toBeInTheDocument()
    expect(screen.getByTestId('path')).toHaveTextContent('/town/bb')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('shows Not Found for unknown towns', async () => {
    mockApi({})
    renderAt('/town/asdfqwer')
    expect(await screen.findByText('Not found page')).toBeInTheDocument()
    expect(fetchNearbyPlaces).not.toHaveBeenCalled()
  })

  it('shares the public web URL (which carries the app-store buttons)', async () => {
    mockApi({ 'slug=paris': PARIS })
    renderAt('/town/paris')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Share' }))
    expect(shareContent).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.go-roam.uk/town/paris' }))
  })
})
