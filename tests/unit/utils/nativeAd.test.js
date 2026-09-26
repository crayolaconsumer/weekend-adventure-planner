import { describe, it, expect, vi, beforeEach } from 'vitest'

const listeners = {}
const plugin = {
  load: vi.fn(() => Promise.resolve({})),
  addListener: vi.fn((name, cb) => { listeners[name] = cb; return Promise.resolve({ remove: () => {} }) }),
}
const initAdMobIfNeeded = vi.fn(() => Promise.resolve())
const track = vi.fn()
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin, Capacitor: { isPluginAvailable: () => true } }))
const consent = { canRequestAds: true }
vi.mock('../../../src/utils/adMob', () => ({
  ensureAdConsent: async () => { await initAdMobIfNeeded({ isPremium: false }); return consent.canRequestAds },
}))
vi.mock('../../../src/utils/analytics', () => ({ track: (...a) => track(...a) }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => true, getPlatform: () => 'android' }))

const { loadNativeAd } = await import('../../../src/utils/nativeAd')

describe('loadNativeAd', () => {
  beforeEach(() => {
    plugin.load.mockClear()
    initAdMobIfNeeded.mockClear()
    track.mockClear()
    consent.canRequestAds = true
  })

  it('never requests when UMP consent does not allow ads', async () => {
    consent.canRequestAds = false
    await expect(loadNativeAd('ad-9', { isPremium: false })).rejects.toMatchObject({ refused: true })
    expect(initAdMobIfNeeded).toHaveBeenCalled()
    expect(plugin.load).not.toHaveBeenCalled()
  })

  it('never requests an ad for an ad-free user', async () => {
    await expect(loadNativeAd('ad-1', { isPremium: true })).rejects.toThrow()
    expect(initAdMobIfNeeded).not.toHaveBeenCalled()
    expect(plugin.load).not.toHaveBeenCalled()
  })

  it('initialises AdMob (consent) first, then loads with the test unit id', async () => {
    await loadNativeAd('ad-2', { isPremium: false })
    expect(initAdMobIfNeeded).toHaveBeenCalledWith({ isPremium: false })
    expect(plugin.load).toHaveBeenCalledWith({ slot: 'ad-2', adUnitId: 'ca-app-pub-3940256099942544/2247696110' })
  })

  it('tracks native clicks and impressions', async () => {
    await loadNativeAd('ad-3', { isPremium: false })
    listeners.adClicked({ slot: 'ad-3' })
    listeners.adImpression({ slot: 'ad-3' })
    expect(track).toHaveBeenCalledWith('ad_card_clicked', { platform: 'android' })
    expect(track).toHaveBeenCalledWith('ad_card_impression', { platform: 'android' })
  })
})
