import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'

const findGooglePlaceId = vi.fn()
const loadPlacesLibrary = vi.fn()
vi.mock('../../../src/utils/googlePlaces', async (orig) => ({
  ...(await orig()),
  findGooglePlaceId: (...args) => findGooglePlaceId(...args),
  loadPlacesLibrary: (...args) => loadPlacesLibrary(...args),
}))
const recordApiCall = vi.fn()
vi.mock('../../../src/utils/apiTelemetry', () => ({ recordApiCall: (...a) => recordApiCall(...a) }))

import GooglePlaceCard from '../../../src/components/GooglePlaceCard'

const york = { id: 'osm-node-1', name: 'York Minster', lat: 53.9623, lng: -1.0819 }

beforeEach(() => {
  findGooglePlaceId.mockReset()
  loadPlacesLibrary.mockReset().mockResolvedValue({})
  recordApiCall.mockReset()
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', 'test-key')
  // No observer: useNearViewport treats the card as in view at once
  vi.stubGlobal('IntersectionObserver', undefined)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('GooglePlaceCard', () => {
  it('renders nothing and asks Google nothing without a key', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '')
    const { container } = render(<GooglePlaceCard place={york} />)
    expect(container).toBeEmptyDOMElement()
    expect(findGooglePlaceId).not.toHaveBeenCalled()
  })

  it('renders nothing for events or places without coordinates', () => {
    const { container: a } = render(<GooglePlaceCard place={{ ...york, datetime: { start: new Date() } }} />)
    const { container: b } = render(<GooglePlaceCard place={{ ...york, lat: null, lng: null }} />)
    expect(a).toBeEmptyDOMElement()
    expect(b).toBeEmptyDOMElement()
    expect(findGooglePlaceId).not.toHaveBeenCalled()
  })

  it('does not touch Google until the card nears the viewport', async () => {
    const observers = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { this.cb = cb; observers.push(this) }
      observe() {}
      disconnect() {}
    })
    findGooglePlaceId.mockResolvedValue('g1')
    const { container } = render(<GooglePlaceCard place={york} />)
    await act(async () => {})
    expect(findGooglePlaceId).not.toHaveBeenCalled()
    act(() => { observers[0].cb([{ isIntersecting: true }]) })
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    expect(findGooglePlaceId).toHaveBeenCalledTimes(1)
  })

  // Regression: with the id cached, no search ran, so the Maps script never
  // loaded and <gmp-place-details-compact> stayed an undefined empty tag.
  it('loads the Maps script even when the place id came from the cache', async () => {
    findGooglePlaceId.mockResolvedValue('g-cached')
    const { container } = render(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    expect(loadPlacesLibrary).toHaveBeenCalledTimes(1)
  })

  it('loads nothing from Google for a remembered "no match"', async () => {
    findGooglePlaceId.mockResolvedValue(null)
    const { container } = render(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(loadPlacesLibrary).not.toHaveBeenCalled()
  })

  it('renders nothing offline', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { container } = render(<GooglePlaceCard place={york} />)
    expect(container).toBeEmptyDOMElement()
    spy.mockRestore()
  })

  it('renders Google\'s element for the matched place, collapsed until it loads', async () => {
    findGooglePlaceId.mockResolvedValue('ChIJsUGD1aUxeUgRNQ2A91LK2pc')
    const { container } = render(<GooglePlaceCard place={york} />)
    const el = await waitFor(() => {
      const found = container.querySelector('gmp-place-details-compact')
      expect(found).not.toBeNull()
      return found
    })
    expect(el.getAttribute('orientation')).toBe('horizontal')
    expect(container.querySelector('gmp-place-details-place-request').getAttribute('place')).toBe('ChIJsUGD1aUxeUgRNQ2A91LK2pc')
    expect(container.querySelector('gmp-place-all-content')).not.toBeNull()
    const card = container.querySelector('.google-place-card')
    expect(card).not.toHaveClass('is-loaded')
    expect(card).toHaveAttribute('inert')

    act(() => { el.dispatchEvent(new Event('gmp-load')) })
    expect(card).toHaveClass('is-loaded')
    expect(card).not.toHaveAttribute('inert')
  })

  // Regression: React 19 set orientation="horizontal" as a property, Google's
  // setter threw InvalidValueError and the error boundary took the page down.
  it('never sets properties on Google\'s element, so its setters cannot throw into React', async () => {
    if (!customElements.get('gmp-place-details-compact')) {
      customElements.define('gmp-place-details-compact', class extends HTMLElement {
        set orientation(v) { throw new Error(`InvalidValueError: ${v} is not an accepted value`) }
        get orientation() { return undefined }
      })
    }
    findGooglePlaceId.mockResolvedValue('g1')
    const { container } = render(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    expect(container.querySelector('gmp-place-details-compact').getAttribute('orientation')).toBe('horizontal')
  })

  it('looks up once per place, not again when enrichment adds the town', async () => {
    findGooglePlaceId.mockResolvedValue('g1')
    const { container, rerender } = render(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    rerender(<GooglePlaceCard place={{ ...york, town: 'York', lat: 53.96231 }} />)
    await act(async () => {})
    expect(findGooglePlaceId).toHaveBeenCalledTimes(1)
  })

  it('hides itself, logs and forgets the cached id on gmp-error', async () => {
    localStorage.setItem('roam_google_place_ids', JSON.stringify({ [york.id]: { id: 'g1', t: Date.now() } }))
    findGooglePlaceId.mockResolvedValue('g1')
    const { container } = render(<GooglePlaceCard place={york} />)
    const el = await waitFor(() => {
      const found = container.querySelector('gmp-place-details-compact')
      expect(found).not.toBeNull()
      return found
    })
    act(() => { el.dispatchEvent(new Event('gmp-error')) })
    expect(container).toBeEmptyDOMElement()
    expect(recordApiCall).toHaveBeenCalledWith(expect.objectContaining({ source: 'google-places', status: 'error' }))
    expect(JSON.parse(localStorage.getItem('roam_google_place_ids'))).not.toHaveProperty(york.id)
  })

  it('hides itself when there is no confident match or the lookup fails', async () => {
    findGooglePlaceId.mockResolvedValueOnce(null)
    const { container: a } = render(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(a).toBeEmptyDOMElement())

    findGooglePlaceId.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { container: b } = render(<GooglePlaceCard place={{ ...york, id: 'other' }} />)
    await waitFor(() => expect(b).toBeEmptyDOMElement())
    expect(recordApiCall).toHaveBeenCalledTimes(1)
  })

  it('renders nothing in the native apps', () => {
    window.Capacitor = { isNativePlatform: () => true }
    const { container } = render(<GooglePlaceCard place={york} />)
    expect(container).toBeEmptyDOMElement()
    expect(findGooglePlaceId).not.toHaveBeenCalled()
    delete window.Capacitor
  })

  // Keep last: the session switch is module state and stays off afterwards
  it('stops asking Google for the rest of the session after the key is refused', async () => {
    findGooglePlaceId.mockRejectedValueOnce(new Error('RefererNotAllowedMapError'))
    const { container: a } = render(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(a).toBeEmptyDOMElement())
    const { container: b } = render(<GooglePlaceCard place={{ ...york, id: 'another' }} />)
    expect(b).toBeEmptyDOMElement()
    expect(findGooglePlaceId).toHaveBeenCalledTimes(1)
  })
})
