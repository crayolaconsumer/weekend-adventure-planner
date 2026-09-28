import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act, fireEvent } from '@testing-library/react'

const findGooglePlaceId = vi.fn()
const loadPlacesLibrary = vi.fn()
vi.mock('../../../src/utils/googlePlaces', async (orig) => {
  const real = await orig()
  return {
    ...real,
    // Like the real lookup: a no-match is cached before it returns
    findGooglePlaceId: async (...args) => {
      const id = await findGooglePlaceId(...args)
      if (id === null) real.rememberGooglePlaceId(args[0].id, null)
      return id
    },
  loadPlacesLibrary: (...args) => loadPlacesLibrary(...args),
  }
})
const recordApiCall = vi.fn()
vi.mock('../../../src/utils/apiTelemetry', () => ({ recordApiCall: (...a) => recordApiCall(...a) }))

import GooglePlaceCard from '../../../src/components/GooglePlaceCard'
import { rememberGooglePlaceId } from '../../../src/utils/googlePlaces'

// Taps "Show Google reviews & hours" when the card offers it (nothing loads before)
function renderOpen(ui) {
  const r = render(ui)
  const button = r.queryByRole('button', { name: /Show Google reviews/ })
  if (button) fireEvent.click(button)
  return r
}


const york = { id: 'osm-node-1', name: 'York Minster', lat: 53.9623, lng: -1.0819 }

beforeEach(() => {
  findGooglePlaceId.mockReset()
  loadPlacesLibrary.mockReset().mockResolvedValue({})
  recordApiCall.mockReset()
  localStorage.clear()
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

  it('does not touch Google until the user taps "Show Google reviews & hours" (each load is billed)', async () => {
    findGooglePlaceId.mockResolvedValue('g1')
    const { container, getByRole } = render(<GooglePlaceCard place={york} />)
    await act(async () => {})
    expect(findGooglePlaceId).not.toHaveBeenCalled()
    expect(loadPlacesLibrary).not.toHaveBeenCalled()
    expect(container.querySelector('gmp-place-details-compact')).toBeNull()
    fireEvent.click(getByRole('button', { name: 'Show Google reviews & hours' }))
    expect(getByRole('button', { name: /Loading Google reviews/ })).toBeDisabled()
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    expect(findGooglePlaceId).toHaveBeenCalledTimes(1)
  })

  it('the button goes away once Google\'s card has loaded', async () => {
    findGooglePlaceId.mockResolvedValue('g1')
    const { container, queryByRole } = renderOpen(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    act(() => { container.querySelector('gmp-place-details-compact').dispatchEvent(new Event('gmp-load')) })
    expect(queryByRole('button')).toBeNull()
  })

  // Regression: with the id cached, no search ran, so the Maps script never
  // loaded and <gmp-place-details-compact> stayed an undefined empty tag.
  it('loads the Maps script even when the place id came from the cache', async () => {
    findGooglePlaceId.mockResolvedValue('g-cached')
    const { container } = renderOpen(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    expect(loadPlacesLibrary).toHaveBeenCalledTimes(1)
  })

  it('a remembered "no match" offers no button and asks Google nothing', async () => {
    rememberGooglePlaceId(york.id, null)
    const { container } = render(<GooglePlaceCard place={york} />)
    expect(container).toBeEmptyDOMElement()
    await act(async () => {})
    expect(findGooglePlaceId).not.toHaveBeenCalled()
    expect(loadPlacesLibrary).not.toHaveBeenCalled()
  })

  it('a signal blip after the tap keeps the card (regression: a dead "Loading…" button)', async () => {
    findGooglePlaceId.mockResolvedValue('g1')
    const { container, queryByRole } = renderOpen(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    const el = container.querySelector('gmp-place-details-compact')
    act(() => { window.dispatchEvent(new Event('offline')) })
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(container.querySelector('gmp-place-details-compact')).toBe(el) // same element, still mounted
    act(() => { el.dispatchEvent(new Event('gmp-load')) })
    expect(queryByRole('button')).toBeNull()
    expect(container.querySelector('.google-place-card.is-loaded')).not.toBeNull()
  })

  it('if Google\'s element never answers, it gives up after 15 s and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      findGooglePlaceId.mockResolvedValue('g1')
      const { container } = renderOpen(<GooglePlaceCard place={york} />)
      await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
      await act(async () => { vi.advanceTimersByTime(15_000) })
      expect(container.textContent).toBe("Google reviews aren't available for this place right now.")
    } finally { vi.useRealTimers() }
  })

  it('a tap that finds no match says so (no silent disappearing button) and loads nothing', async () => {
    findGooglePlaceId.mockResolvedValue(null)
    const { findByRole } = renderOpen(<GooglePlaceCard place={york} />)
    expect((await findByRole('status')).textContent).toBe("Google reviews aren't available for this place right now.")
    expect(loadPlacesLibrary).not.toHaveBeenCalled()
  })

  it('renders nothing offline', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { container } = renderOpen(<GooglePlaceCard place={york} />)
    expect(container).toBeEmptyDOMElement()
    spy.mockRestore()
  })

  it('renders Google\'s element for the matched place, collapsed until it loads', async () => {
    findGooglePlaceId.mockResolvedValue('ChIJsUGD1aUxeUgRNQ2A91LK2pc')
    const { container } = renderOpen(<GooglePlaceCard place={york} />)
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
    const { container } = renderOpen(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    expect(container.querySelector('gmp-place-details-compact').getAttribute('orientation')).toBe('horizontal')
  })

  it('looks up once per place, not again when enrichment adds the town', async () => {
    findGooglePlaceId.mockResolvedValue('g1')
    const { container, rerender } = renderOpen(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(container.querySelector('gmp-place-details-compact')).not.toBeNull())
    rerender(<GooglePlaceCard place={{ ...york, town: 'York', lat: 53.96231 }} />)
    await act(async () => {})
    expect(findGooglePlaceId).toHaveBeenCalledTimes(1)
  })

  it('hides itself, logs and forgets the cached id on gmp-error', async () => {
    localStorage.setItem('roam_google_place_ids', JSON.stringify({ [york.id]: { id: 'g1', t: Date.now() } }))
    findGooglePlaceId.mockResolvedValue('g1')
    const { container } = renderOpen(<GooglePlaceCard place={york} />)
    const el = await waitFor(() => {
      const found = container.querySelector('gmp-place-details-compact')
      expect(found).not.toBeNull()
      return found
    })
    act(() => { el.dispatchEvent(new Event('gmp-error')) })
    expect(container.textContent).toBe("Google reviews aren't available for this place right now.")
    expect(container.querySelector('gmp-place-details-compact')).toBeNull()
    expect(recordApiCall).toHaveBeenCalledWith(expect.objectContaining({ source: 'google-places', status: 'error' }))
    expect(JSON.parse(localStorage.getItem('roam_google_place_ids'))).not.toHaveProperty(york.id)
  })

  it('hides itself when there is no confident match or the lookup fails', async () => {
    findGooglePlaceId.mockResolvedValueOnce(null)
    const { container: a } = renderOpen(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(a.textContent).toBe("Google reviews aren't available for this place right now."))

    findGooglePlaceId.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { container: b } = renderOpen(<GooglePlaceCard place={{ ...york, id: 'other' }} />)
    await waitFor(() => expect(b.textContent).toBe("Google reviews aren't available for this place right now."))
    expect(recordApiCall).toHaveBeenCalledTimes(1)
  })

  it('renders nothing in the native apps', () => {
    window.Capacitor = { isNativePlatform: () => true }
    const { container } = renderOpen(<GooglePlaceCard place={york} />)
    expect(container).toBeEmptyDOMElement()
    expect(findGooglePlaceId).not.toHaveBeenCalled()
    delete window.Capacitor
  })

  // Keep last: the session switch is module state and stays off afterwards
  it('stops asking Google for the rest of the session after the key is refused', async () => {
    findGooglePlaceId.mockRejectedValueOnce(new Error('RefererNotAllowedMapError'))
    const { container: a } = renderOpen(<GooglePlaceCard place={york} />)
    await waitFor(() => expect(a).toBeEmptyDOMElement())
    const { container: b } = renderOpen(<GooglePlaceCard place={{ ...york, id: 'another' }} />)
    expect(b).toBeEmptyDOMElement()
    expect(findGooglePlaceId).toHaveBeenCalledTimes(1)
  })
})
