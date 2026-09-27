import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Framer's exit animations keep old cards in the DOM under fake timers;
// plain elements keep the stack deterministic.
vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _h, whileTap: _w, ...rest }) => rest
  const motion = new Proxy({}, {
    get: (_, tag) => React.forwardRef((props, ref) => React.createElement(tag, { ...strip(props), ref })),
  })
  return { motion, AnimatePresence: ({ children }) => children }
})

const state = { native: false, premium: false, noAds: false, authLoading: false, webFill: 'filled', nativeFill: true }
const openDirections = vi.fn()
const loadNativeAd = vi.fn()
const destroyNativeAd = vi.fn()
const track = vi.fn()

vi.mock('../../../src/components/SwipeCard', () => ({
  default: ({ place, onSwipe, isTop }) => (isTop ? (
    <div>
      <span>{`card ${place.id}`}</span>
      <button onClick={() => onSwipe?.('nope')}>{`skip ${place.id}`}</button>
    </div>
  ) : null),
}))
vi.mock('../../../src/components/SponsoredCard', () => ({ default: () => <div>promoter</div> }))
vi.mock('../../../src/components/AdCard', async () => {
  const React = await import('react')
  return {
    default: function AdCardMock({ slot, isTop, onSwipe, onStatus }) {
      React.useEffect(() => {
        if (state.webFill) onStatus(slot, state.webFill)
      }, [slot, onStatus])
      return isTop ? (
        <div>
          <span>{`ad ${slot}`}</span>
          <button onClick={() => onSwipe?.('like')}>ad right</button>
          <button onClick={() => onSwipe?.('go')}>ad go</button>
          <button onClick={() => onSwipe?.('nope', { unfilled: true })}>ad skip unfilled</button>
          <button onClick={() => onStatus(slot, 'unfilled', { waitedMs: 2500, reportedByCard: true })}>ad timeout</button>
        </div>
      ) : null
    },
  }
})
vi.mock('../../../src/hooks/useTopContributions', () => ({ useTopContributions: () => ({ contributions: {} }), tipPrefetchIds: () => [] }))
vi.mock('../../../src/hooks/useSubscription', () => ({
  useSubscription: () => ({ isPremium: state.premium, noAds: state.premium || state.noAds }),
}))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ loading: state.authLoading }) }))
vi.mock('../../../src/utils/apiClient', () => ({ enrichPlace: () => Promise.resolve(null) }))
vi.mock('../../../src/utils/placeImage', () => ({ resolvePlaceImageWithMeta: () => Promise.resolve(null) }))
vi.mock('../../../src/utils/imageCache', () => ({ fetchAndCacheImage: () => Promise.resolve(null) }))
vi.mock('../../../src/utils/navigation', () => ({ openDirections: (...a) => openDirections(...a) }))
vi.mock('../../../src/utils/analytics', () => ({ track: (...a) => track(...a) }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => state.native, getPlatform: () => (state.native ? 'ios' : 'web') }))
vi.mock('../../../src/utils/nativeAd', () => ({
  isNativeAdAvailable: () => state.native,
  loadNativeAd: (...a) => loadNativeAd(...a),
  destroyNativeAd: (...a) => destroyNativeAd(...a),
}))
const injectAdSenseScript = vi.fn()
vi.mock('../../../src/utils/adSense', () => ({
  isAdSenseConfigured: () => true,
  ADSENSE_SLOT_CARD: '123',
  injectAdSenseScript: () => injectAdSenseScript(),
}))

const { default: CardStack } = await import('../../../src/components/CardStack')

const makePlaces = (n, tag = 'p') => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, name: `Place ${i}`, lat: 1, lng: 2 }))
const places = makePlaces(9)

function renderStack(props = {}) {
  const handlers = { onSwipe: vi.fn(), onAnySwipe: vi.fn() }
  const ui = (extra = {}) => (
    <MemoryRouter>
      <CardStack places={places} {...handlers} {...props} {...extra} />
    </MemoryRouter>
  )
  const { rerender } = render(ui())
  return { ...handlers, rerender: (extra) => rerender(ui(extra)) }
}

const advance = () => act(() => { vi.advanceTimersByTime(150) })
const flush = () => act(async () => {})

function skipRegularCards(n, from = 0) {
  for (let i = from; i < from + n; i++) {
    fireEvent.click(screen.getByRole('button', { name: `skip p${i}` }))
    advance()
  }
}

describe('CardStack ad slots', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(state, { native: false, premium: false, noAds: false, authLoading: false, webFill: 'filled', nativeFill: true })
    openDirections.mockReset()
    track.mockReset()
    injectAdSenseScript.mockReset()
    destroyNativeAd.mockReset().mockResolvedValue()
    loadNativeAd.mockReset().mockImplementation(() => (state.nativeFill ? Promise.resolve({}) : Promise.reject(new Error('no fill'))))
  })
  afterEach(() => vi.useRealTimers())

  it('shows a filled ad after 8 cards; any swipe on it only advances', () => {
    const { onSwipe, onAnySwipe } = renderStack()
    skipRegularCards(8)
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ad go' }))
    advance()

    expect(onAnySwipe).toHaveBeenCalledTimes(9)
    expect(onSwipe).toHaveBeenCalledTimes(8)
    expect(onSwipe.mock.calls.every(([, place]) => place)).toBe(true)
    expect(openDirections).not.toHaveBeenCalled()
    expect(screen.getByText('card p8')).toBeInTheDocument()
  })

  it('a right swipe on an ad never reaches the save flow', () => {
    const { onSwipe, onAnySwipe } = renderStack()
    skipRegularCards(8)
    fireEvent.click(screen.getByRole('button', { name: 'ad right' }))
    advance()
    expect(onAnySwipe).toHaveBeenLastCalledWith('like', undefined, { isAd: true })
    expect(onSwipe).toHaveBeenCalledTimes(8)
  })

  it('flags ad card swipes to the interstitial cadence; regular swipes are unflagged', () => {
    const { onAnySwipe } = renderStack()
    skipRegularCards(1)
    expect(onAnySwipe).toHaveBeenLastCalledWith('nope', expect.objectContaining({ id: 'p0' }), undefined)
  })

  it('a web ad skipped before it filled advances without counting as a swipe', () => {
    state.webFill = null
    const { onAnySwipe, onSwipe } = renderStack()
    skipRegularCards(8)
    fireEvent.click(screen.getByRole('button', { name: 'ad skip unfilled' }))
    advance()
    expect(onAnySwipe).toHaveBeenCalledTimes(8)
    expect(onSwipe).toHaveBeenCalledTimes(8)
    expect(screen.getByText('card p8')).toBeInTheDocument()
  })

  it('native: an ad still waiting in the deck at 55 minutes collapses and is released', async () => {
    state.native = true
    state.webFill = null
    renderStack()
    skipRegularCards(5)
    await flush()
    act(() => { vi.advanceTimersByTime(54 * 60 * 1000) })
    expect(destroyNativeAd).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(60 * 1000) })
    expect(destroyNativeAd).toHaveBeenCalledWith('ad-1')
    skipRegularCards(3, 5)
    expect(screen.queryByText(/^ad /)).toBeNull()
    expect(screen.getByText('card p8')).toBeInTheDocument()
  })

  it('native: an ad that ages out while on top stays (it is already being seen)', async () => {
    state.native = true
    state.webFill = null
    renderStack()
    skipRegularCards(5)
    await flush()
    skipRegularCards(3, 5)
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(56 * 60 * 1000) })
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
  })

  it('web: loads the AdSense script (no unit) once an ad slot is within 3 cards', () => {
    renderStack()
    skipRegularCards(4)
    expect(injectAdSenseScript).not.toHaveBeenCalled()
    skipRegularCards(1, 4)
    expect(injectAdSenseScript).toHaveBeenCalled()
  })

  it('native: a load that settles after the deck changed never touches the new deck', async () => {
    state.native = true
    state.webFill = null
    const pending = []
    loadNativeAd.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
    const { rerender } = renderStack()
    skipRegularCards(5)
    expect(loadNativeAd).toHaveBeenCalledWith('ad-1', { isPremium: false })
    rerender({ places: makePlaces(9, 'q') })
    await act(async () => { pending[0].reject(new Error('no fill')) })
    expect(track).not.toHaveBeenCalledWith('ad_card_unfilled', expect.anything())
    // the new deck's first ad has its own id and loads and shows normally
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: `skip q${i}` }))
      advance()
    }
    const fresh = loadNativeAd.mock.calls.map(c => c[0]).filter(id => id !== 'ad-1')
    expect(fresh).toEqual(['ad-1.1'])
    await act(async () => { pending[1].resolve({}) })
    for (let i = 5; i < 8; i++) {
      fireEvent.click(screen.getByRole('button', { name: `skip q${i}` }))
      advance()
    }
    expect(screen.getByText('ad ad-1.1')).toBeInTheDocument()
  })

  it('native: load-more (append) keeps the position, the deck and ad-1\'s loaded ad', async () => {
    state.native = true
    state.webFill = null
    const { rerender } = renderStack()
    skipRegularCards(5)
    await flush()
    expect(loadNativeAd).toHaveBeenCalledTimes(1)
    rerender({ places: [...places, ...makePlaces(12).slice(9)] })
    await flush()
    expect(destroyNativeAd).not.toHaveBeenCalled()
    expect(loadNativeAd).toHaveBeenCalledTimes(1)
    expect(screen.getByText('card p5')).toBeInTheDocument()
    skipRegularCards(3, 5)
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
  })

  it('native: no ad request from the stale index in the commit where the deck changes', async () => {
    state.native = true
    state.webFill = null
    const { rerender } = renderStack()
    skipRegularCards(5)
    await flush()
    loadNativeAd.mockClear()
    // new deck: slot ad-1.1 sits at index 8; the old index (5) would reach it
    rerender({ places: makePlaces(9, 'q') })
    await flush()
    expect(loadNativeAd).not.toHaveBeenCalled()
    expect(screen.getByText('card q0')).toBeInTheDocument()
  })

  it('native: a load refused for consent collapses the slot without reporting a no-fill', async () => {
    state.native = true
    state.webFill = null
    loadNativeAd.mockImplementation(() => Promise.reject(Object.assign(new Error('no consent'), { refused: true })))
    renderStack()
    skipRegularCards(5)
    await flush()
    expect(track).not.toHaveBeenCalledWith('ad_card_unfilled', expect.anything())
    skipRegularCards(3, 5)
    expect(screen.getByText('card p8')).toBeInTheDocument()
  })

  it('web: a timed-out fill collapses but is left for AdCard to report (no double count)', () => {
    state.webFill = null
    renderStack()
    skipRegularCards(8)
    fireEvent.click(screen.getByRole('button', { name: 'ad timeout' }))
    expect(screen.getByText('card p8')).toBeInTheDocument()
    expect(track).not.toHaveBeenCalledWith('ad_card_unfilled', expect.anything())
  })

  it('native: an old-deck ad that loads late is released, not shown', async () => {
    state.native = true
    state.webFill = null
    const pending = []
    loadNativeAd.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const { rerender } = renderStack()
    skipRegularCards(5)
    rerender({ places: makePlaces(9, 'q') })
    destroyNativeAd.mockClear()
    await act(async () => { pending[0]({}) })
    expect(destroyNativeAd).toHaveBeenCalledWith('ad-1')
  })

  it('native: unfilled reports how long the load waited', async () => {
    state.native = true
    state.webFill = null
    state.nativeFill = false
    renderStack()
    skipRegularCards(5)
    await flush()
    expect(track).toHaveBeenCalledWith('ad_card_unfilled', expect.objectContaining({ platform: 'ios', waitedMs: expect.any(Number) }))
  })

  it('native: consent withdrawn releases every loaded ad and collapses its slot', async () => {
    state.native = true
    state.webFill = null
    renderStack()
    skipRegularCards(5)
    await flush()
    act(() => { window.dispatchEvent(new CustomEvent('roam-ads-revoked')) })
    expect(destroyNativeAd).toHaveBeenCalledWith('ad-1')
    expect(track).not.toHaveBeenCalledWith('ad_card_unfilled', expect.anything())
    skipRegularCards(3, 5)
    expect(screen.queryByText(/^ad /)).toBeNull()
    expect(screen.getByText('card p8')).toBeInTheDocument()
  })

  it('progress counts places only, not the ad card', () => {
    renderStack()
    expect(screen.getByText('1 of 9')).toBeInTheDocument()
    skipRegularCards(8)
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
    expect(screen.getByText('8 of 9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ad right' }))
    advance()
    expect(screen.getByText('9 of 9')).toBeInTheDocument()
  })

  it('collapses a web ad that comes back unfilled, so the next place is on top', () => {
    state.webFill = 'unfilled'
    renderStack()
    skipRegularCards(8)
    expect(screen.queryByText(/^ad /)).toBeNull()
    expect(screen.getByText('card p8')).toBeInTheDocument()
    expect(track).toHaveBeenCalledWith('ad_card_unfilled', { platform: 'web' })
  })

  it('web: keeps a still-filling ad on top (AdCard requests it only there, then reports)', () => {
    state.webFill = null
    renderStack()
    skipRegularCards(8)
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
  })

  it('native: collapses an ad that is still loading when it reaches the top', () => {
    state.native = true
    state.webFill = null
    loadNativeAd.mockImplementation(() => new Promise(() => {}))
    renderStack()
    skipRegularCards(8)
    expect(screen.queryByText(/^ad /)).toBeNull()
    expect(screen.getByText('card p8')).toBeInTheDocument()
    expect(destroyNativeAd).toHaveBeenCalledWith('ad-1')
  })

  it('native: loads the slot ahead of time, collapses and releases it on no fill', async () => {
    state.native = true
    state.webFill = null
    state.nativeFill = false
    renderStack()
    skipRegularCards(5)
    expect(loadNativeAd).toHaveBeenCalledWith('ad-1', { isPremium: false })
    await flush()
    expect(destroyNativeAd).toHaveBeenCalledWith('ad-1')
    skipRegularCards(3, 5)
    expect(screen.getByText('card p8')).toBeInTheDocument()
  })

  it('native: a filled slot is shown when it reaches the top', async () => {
    state.native = true
    state.webFill = null
    renderStack()
    skipRegularCards(5)
    await flush()
    skipRegularCards(3, 5)
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
  })

  it('native: a new deck releases every ad loaded for the old one', async () => {
    state.native = true
    state.webFill = null
    const { rerender } = renderStack()
    skipRegularCards(5)
    await flush()
    expect(destroyNativeAd).not.toHaveBeenCalled()
    rerender({ places: makePlaces(9, 'q') })
    expect(destroyNativeAd).toHaveBeenCalledWith('ad-1')
  })

  it('premium users get no ad slot and no ad request', () => {
    state.native = true
    state.premium = true
    renderStack()
    skipRegularCards(8)
    expect(screen.getByText('card p8')).toBeInTheDocument()
    expect(loadNativeAd).not.toHaveBeenCalled()
  })

  it('signed in but tier unknown (auth check failed) gets no ad slot and no request', () => {
    state.native = true
    state.noAds = true
    renderStack()
    skipRegularCards(8)
    expect(screen.getByText('card p8')).toBeInTheDocument()
    expect(loadNativeAd).not.toHaveBeenCalled()
  })

  it('no ad slot while auth is first loading', () => {
    state.authLoading = true
    renderStack()
    skipRegularCards(8)
    expect(screen.getByText('card p8')).toBeInTheDocument()
  })

  it('an auth reload mid-deck (app foreground) does not shift or drop cards', () => {
    const deck = makePlaces(20)
    const { rerender } = renderStack({ places: deck })
    skipRegularCards(8)
    fireEvent.click(screen.getByRole('button', { name: 'ad right' }))
    advance()
    skipRegularCards(2, 8)
    expect(screen.getByText('card p10')).toBeInTheDocument()
    expect(screen.getByText('11 of 20')).toBeInTheDocument()

    state.authLoading = true
    rerender()
    expect(screen.getByText('card p10')).toBeInTheDocument()
    expect(screen.getByText('11 of 20')).toBeInTheDocument()

    state.authLoading = false
    rerender()
    expect(screen.getByText('card p10')).toBeInTheDocument()
    skipRegularCards(6, 10)
    expect(screen.getByText('ad ad-2')).toBeInTheDocument()
  })

  it('an auth reload while the ad is on top keeps it there (no remount, no drop)', () => {
    const { rerender } = renderStack()
    skipRegularCards(8)
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
    state.authLoading = true
    rerender()
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
    state.authLoading = false
    rerender()
    expect(screen.getByText('ad ad-1')).toBeInTheDocument()
  })

  it('ads switching off mid-deck (tier unknown) keep passed cards in place and drop the ones ahead', () => {
    const deck = makePlaces(20)
    const { rerender } = renderStack({ places: deck })
    skipRegularCards(8)
    fireEvent.click(screen.getByRole('button', { name: 'ad right' }))
    advance()
    skipRegularCards(2, 8)

    state.noAds = true
    rerender()
    expect(screen.getByText('card p10')).toBeInTheDocument()
    expect(screen.getByText('11 of 20')).toBeInTheDocument()
    skipRegularCards(6, 10)
    expect(screen.queryByText(/^ad /)).toBeNull()
    expect(screen.getByText('card p16')).toBeInTheDocument()
  })
})
