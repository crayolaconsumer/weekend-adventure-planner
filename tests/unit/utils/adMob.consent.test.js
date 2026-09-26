import { describe, it, expect, vi, beforeEach } from 'vitest'

const consent = { info: {} }
const listeners = {}
const AdMob = {
  initialize: vi.fn(() => Promise.resolve()),
  trackingAuthorizationStatus: vi.fn(() => Promise.resolve({ status: 'notDetermined' })),
  requestTrackingAuthorization: vi.fn(() => Promise.resolve()),
  hideBanner: vi.fn(() => Promise.resolve()),
  removeBanner: vi.fn(() => Promise.resolve()),
  addListener: vi.fn((name, cb) => { listeners[name] = cb; return Promise.resolve({ remove: () => {} }) }),
  requestConsentInfo: vi.fn(() => Promise.resolve(consent.info)),
  showConsentForm: vi.fn(() => Promise.resolve(consent.afterForm)),
  showPrivacyOptionsForm: vi.fn(() => Promise.resolve()),
  showBanner: vi.fn(() => Promise.resolve()),
  prepareInterstitial: vi.fn(() => Promise.resolve()),
  showInterstitial: vi.fn(() => Promise.resolve()),
}
vi.mock('@capacitor-community/admob', () => ({
  AdMob,
  MaxAdContentRating: { ParentalGuidance: 'PG' },
  BannerAdPosition: { BOTTOM_CENTER: 'BOTTOM_CENTER' },
  BannerAdSize: { ADAPTIVE_BANNER: 'ADAPTIVE_BANNER' },
  BannerAdPluginEvents: { SizeChanged: 'bannerAdSizeChanged', Loaded: 'bannerAdLoaded', FailedToLoad: 'bannerAdFailedToLoad' },
}))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => true, getPlatform: () => 'ios' }))

async function fresh(info, afterForm) {
  consent.info = info
  consent.afterForm = afterForm
  vi.resetModules()
  return import('../../../src/utils/adMob')
}

const flushAll = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('adMob consent gate (UMP canRequestAds)', () => {
  beforeEach(() => Object.values(AdMob).forEach(f => f.mockClear()))

  it('requests nothing when UMP says ads may not be requested', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: false })
    await m.showBanner()
    for (let i = 0; i < 23; i++) await m.maybeShowInterstitial({ isPremium: false })
    // the preload at swipe 22 is fire-and-forget: give it time to land
    await new Promise(r => setTimeout(r, 30))
    expect(await m.ensureAdConsent()).toBe(false)
    expect(AdMob.showBanner).not.toHaveBeenCalled()
    expect(AdMob.prepareInterstitial).not.toHaveBeenCalled()
  })

  it('treats a failed consent check as no ads', async () => {
    const m = await fresh({})
    AdMob.requestConsentInfo.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    await m.showBanner()
    expect(AdMob.showBanner).not.toHaveBeenCalled()
  })

  it('uses the consent form result: allowed after the user consents', async () => {
    const m = await fresh(
      { status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false },
      { status: 'OBTAINED', canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' },
    )
    await m.showBanner()
    expect(AdMob.showConsentForm).toHaveBeenCalled()
    expect(AdMob.showBanner).toHaveBeenCalled()
    expect(await m.isPrivacyOptionsRequired()).toBe(true)
    // one consent lookup for the whole session, however often it is asked
    await m.isPrivacyOptionsRequired()
    expect(AdMob.requestConsentInfo).toHaveBeenCalledTimes(1)
  })

  it('re-reads consent after the privacy options form; withdrawal hides the banner and tells the deck', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: true })
    await m.showBanner()
    expect(AdMob.showBanner).toHaveBeenCalled()
    const revoked = vi.fn()
    window.addEventListener(m.ADS_REVOKED_EVENT, revoked)
    consent.info = { status: 'REQUIRED', canRequestAds: false }
    await m.showPrivacyOptions()
    window.removeEventListener(m.ADS_REVOKED_EVENT, revoked)
    expect(await m.ensureAdConsent()).toBe(false)
    expect(AdMob.removeBanner).toHaveBeenCalled()
    expect(revoked).toHaveBeenCalledTimes(1)
  })

  it('no revoke event when consent was already off', async () => {
    const m = await fresh({ status: 'REQUIRED', canRequestAds: false })
    await m.initAdMobIfNeeded({ isPremium: false })
    const revoked = vi.fn()
    window.addEventListener(m.ADS_REVOKED_EVENT, revoked)
    await m.showPrivacyOptions()
    window.removeEventListener(m.ADS_REVOKED_EVENT, revoked)
    expect(revoked).not.toHaveBeenCalled()
  })

  it('a failed consent check is retried (at most once a minute); success allows ads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const m = await fresh({ status: 'NOT_REQUIRED', canRequestAds: true })
      AdMob.requestConsentInfo.mockImplementationOnce(() => Promise.reject(new Error('offline')))
      expect(await m.ensureAdConsent()).toBe(false)
      vi.setSystemTime(Date.now() + 30_000)
      expect(await m.ensureAdConsent()).toBe(false)
      expect(AdMob.requestConsentInfo).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 31_000)
      expect(await m.ensureAdConsent()).toBe(true)
      expect(AdMob.requestConsentInfo).toHaveBeenCalledTimes(2)
      await m.showBanner()
      expect(AdMob.showBanner).toHaveBeenCalled()
      // once known, no more lookups
      vi.setSystemTime(Date.now() + 120_000)
      await m.ensureAdConsent()
      expect(AdMob.requestConsentInfo).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs UMP consent before the iOS ATT prompt', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: true })
    await m.initAdMobIfNeeded({ isPremium: false })
    const ump = AdMob.requestConsentInfo.mock.invocationCallOrder[0]
    const att = AdMob.requestTrackingAuthorization.mock.invocationCallOrder[0]
    expect(ump).toBeLessThan(att)
  })
})

describe('init and consent edge cases', () => {
  beforeEach(() => Object.values(AdMob).forEach(f => f.mockClear()))

  it('never requests an ad when AdMob.initialize failed', async () => {
    const m = await fresh({ status: 'NOT_REQUIRED', canRequestAds: true })
    AdMob.initialize.mockImplementationOnce(() => Promise.reject(new Error('init failed')))
    expect(await m.ensureAdConsent()).toBe(false)
    await m.showBanner()
    expect(AdMob.showBanner).not.toHaveBeenCalled()
  })

  it('waits for a consent check already in flight instead of answering false', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: true })
    await m.initAdMobIfNeeded({ isPremium: false })
    let release
    // a retry-worthy failure, then a slow successful check
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      AdMob.requestConsentInfo.mockImplementationOnce(() => Promise.reject(new Error('offline')))
      await m.showPrivacyOptions() // leaves consent unknown
      vi.setSystemTime(Date.now() + 61_000)
      AdMob.requestConsentInfo.mockImplementationOnce(() => new Promise(r => { release = r }))
      const first = m.ensureAdConsent() // starts the retry
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      const second = m.ensureAdConsent() // must wait for it, not answer false
      release({ status: 'OBTAINED', canRequestAds: true })
      expect(await first).toBe(true)
      expect(await second).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('banner teardown and reserved space', () => {
  beforeEach(() => {
    Object.values(AdMob).forEach(f => f.mockClear())
    document.body.classList.remove('has-native-banner')
    document.documentElement.style.removeProperty('--native-banner-height')
  })

  it('hide removes the banner (Android hide left it GONE for good); the next show builds a new one', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: true })
    await m.showBanner()
    await m.hideBanner()
    expect(AdMob.removeBanner).toHaveBeenCalledTimes(1)
    expect(AdMob.hideBanner).not.toHaveBeenCalled()
    await m.showBanner()
    expect(AdMob.showBanner).toHaveBeenCalledTimes(2)
  })

  it('reserves the banner height only once an ad loads, and releases it after', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: true })
    await m.showBanner()
    // requested but not loaded: no gap under the deck yet
    expect(document.body.classList.contains('has-native-banner')).toBe(false)
    listeners.bannerAdLoaded()
    expect(document.body.classList.contains('has-native-banner')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--native-banner-height')).toBe('60px')
    listeners.bannerAdSizeChanged({ width: 320, height: 50 })
    expect(document.documentElement.style.getPropertyValue('--native-banner-height')).toBe('50px')
    listeners.bannerAdSizeChanged({ width: 0, height: 0 })
    expect(document.documentElement.style.getPropertyValue('--native-banner-height')).toBe('50px')
    await m.hideBanner()
    expect(document.body.classList.contains('has-native-banner')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--native-banner-height')).toBe('')
  })

  it('gives the space back when the banner fails to fill (regression: empty 96px gap)', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: true })
    await m.showBanner()
    listeners.bannerAdLoaded()
    listeners.bannerAdFailedToLoad({ code: 3 })
    expect(document.body.classList.contains('has-native-banner')).toBe(false)
  })

  it('no space reserved when the banner was never shown (no consent)', async () => {
    const m = await fresh({ status: 'REQUIRED', canRequestAds: false })
    await m.showBanner()
    expect(document.body.classList.contains('has-native-banner')).toBe(false)
  })
})

describe('interstitial never straight after an ad card', () => {
  it('defers a due interstitial by one swipe when the swipe was on an ad card', async () => {
    const m = await fresh({ status: 'OBTAINED', canRequestAds: true })
    for (let i = 0; i < 22; i++) await m.maybeShowInterstitial({ isPremium: false })
    // preload fires at swipe 22; let it land so the interstitial is ready
    await vi.waitFor(() => expect(AdMob.prepareInterstitial).toHaveBeenCalled())
    await flushAll()
    await m.maybeShowInterstitial({ isPremium: false })
    await m.maybeShowInterstitial({ isPremium: false })
    await m.maybeShowInterstitial({ isPremium: false, afterAdCard: true }) // 25th: an ad card
    expect(AdMob.showInterstitial).not.toHaveBeenCalled()
    await m.maybeShowInterstitial({ isPremium: false }) // next regular swipe
    expect(AdMob.showInterstitial).toHaveBeenCalledTimes(1)
  })
})
