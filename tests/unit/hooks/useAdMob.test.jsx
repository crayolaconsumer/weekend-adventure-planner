import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const env = { noAds: false, authLoading: false }
const showBanner = vi.fn()
const hideBanner = vi.fn()
const maybeShowInterstitial = vi.fn()
vi.mock('../../../src/utils/adMob', () => ({
  initAdMobIfNeeded: () => Promise.resolve(),
  showBanner: (...a) => showBanner(...a),
  hideBanner: (...a) => hideBanner(...a),
  maybeShowInterstitial: (...a) => maybeShowInterstitial(...a),
  resetAdMobState: () => {},
}))
vi.mock('../../../src/utils/analytics', () => ({ track: () => {} }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => true, getPlatform: () => 'ios' }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: env.authLoading }) }))
vi.mock('../../../src/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: false, noAds: env.noAds }) }))

const { useAdMob, shouldShowBanner } = await import('../../../src/hooks/useAdMob')
const { setAdCardActive } = await import('../../../src/utils/nativeAd')

describe('useAdMob', () => {
  beforeEach(() => {
    Object.assign(env, { noAds: false, authLoading: false })
    setAdCardActive(false)
    for (const f of [showBanner, hideBanner, maybeShowInterstitial]) f.mockReset().mockResolvedValue()
  })

  it('hides the banner while a native ad card is up and restores it after', async () => {
    renderHook(() => useAdMob({ bannerOnScreen: true }))
    expect(showBanner).toHaveBeenCalledTimes(1)
    act(() => setAdCardActive(true))
    expect(hideBanner).toHaveBeenCalled()
    act(() => setAdCardActive(false))
    await waitFor(() => expect(showBanner).toHaveBeenCalledTimes(2))
  })

  it('does not show the banner on mount while an ad card is up', () => {
    setAdCardActive(true)
    renderHook(() => useAdMob({ bannerOnScreen: true }))
    expect(showBanner).not.toHaveBeenCalled()
  })

  it('ad card events never bring the banner back off Discover', () => {
    renderHook(() => useAdMob({ bannerOnScreen: false }))
    act(() => setAdCardActive(true))
    act(() => setAdCardActive(false))
    expect(showBanner).not.toHaveBeenCalled()
  })

  it('tells the interstitial cadence when a swipe was on an ad card', () => {
    const { result } = renderHook(() => useAdMob({ bannerOnScreen: false }))
    result.current.trackSwipe('nope', undefined, { isAd: true })
    expect(maybeShowInterstitial).toHaveBeenLastCalledWith(expect.objectContaining({ afterAdCard: true }))
    result.current.trackSwipe('nope', { id: 'p1' })
    expect(maybeShowInterstitial).toHaveBeenLastCalledWith(expect.objectContaining({ afterAdCard: false }))
  })

  it('ad-free (premium or signed in with tier unknown): no banner, no interstitial, even after an ad card event', () => {
    env.noAds = true
    const { result } = renderHook(() => useAdMob({ bannerOnScreen: true }))
    act(() => setAdCardActive(true))
    act(() => setAdCardActive(false))
    result.current.trackSwipe('nope', null)
    expect(showBanner).not.toHaveBeenCalled()
    expect(maybeShowInterstitial).not.toHaveBeenCalled()
  })

  it('a banner that lands after the screen left is taken straight down', async () => {
    let land
    showBanner.mockImplementationOnce(() => new Promise(r => { land = r }))
    const { unmount } = renderHook(() => useAdMob({ bannerOnScreen: true }))
    unmount()
    hideBanner.mockClear()
    await act(async () => { land() })
    expect(hideBanner).toHaveBeenCalled()
  })

  it('a banner that lands while an ad card is up is taken straight down', async () => {
    let land
    showBanner.mockImplementationOnce(() => new Promise(r => { land = r }))
    renderHook(() => useAdMob({ bannerOnScreen: true }))
    setAdCardActive(true)
    hideBanner.mockClear()
    await act(async () => { land() })
    expect(hideBanner).toHaveBeenCalled()
  })
})

describe('shouldShowBanner (Discover gate)', () => {
  const on = { location: { lat: 1, lng: 2 }, count: 5, loading: false, error: null }
  it('only with a location (real or default), places showing, not loading, no error', () => {
    expect(shouldShowBanner(on)).toBe(true)
    expect(shouldShowBanner({ ...on, location: null })).toBe(false)
    expect(shouldShowBanner({ ...on, count: 0 })).toBe(false)
    expect(shouldShowBanner({ ...on, loading: true })).toBe(false)
    expect(shouldShowBanner({ ...on, error: new Error('x') })).toBe(false)
  })
})
