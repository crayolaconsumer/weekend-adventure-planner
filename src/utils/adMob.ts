/// <reference types="vite/client" />
/**
 * AdMob (mobile) wrapper — banner + interstitial for free users on iOS/Android.
 *
 * Web is a no-op (use adSense.js for the equivalent web monetization).
 *
 * Wiring:
 *   1. initAdMobIfNeeded()       — call once on app mount, after the
 *                                  user is determined NOT to be premium
 *                                  and the runtime is native. Handles
 *                                  ATT prompt on iOS and UMP consent
 *                                  flow for UK/EEA.
 *   2. showBanner()              — call when the Discover screen mounts;
 *                                  hideBanner() on unmount.
 *   3. maybeShowInterstitial()   — call after a swipe; internally
 *                                  rate-limits to "every N swipes" and
 *                                  "no more than once every M seconds".
 *
 * App IDs live in Info.plist / AndroidManifest (compile-time, hardcoded).
 * Unit IDs live in env vars (build-time, swappable per environment).
 *
 *   VITE_ADMOB_IOS_BANNER_ID
 *   VITE_ADMOB_IOS_INTERSTITIAL_ID
 *   VITE_ADMOB_ANDROID_BANNER_ID
 *   VITE_ADMOB_ANDROID_INTERSTITIAL_ID
 *
 * Until those env vars are set with real IDs, we use Google's official
 * test IDs (safe to ship, always return test ads, no revenue impact on
 * the real account).
 */

import { isNative, getPlatform } from './nativeBridge'

// Google's official test IDs — safe to ship in dev/staging.
// https://developers.google.com/admob/ios/test-ads
// https://developers.google.com/admob/android/test-ads
const TEST_IDS = {
  ios: {
    banner: 'ca-app-pub-3940256099942544/2934735716',
    interstitial: 'ca-app-pub-3940256099942544/4411468910',
  },
  android: {
    banner: 'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
  },
}

const ENV = import.meta.env as Record<string, string | undefined>

function unitIds() {
  const platform = getPlatform()
  if (platform === 'ios') {
    return {
      banner: ENV.VITE_ADMOB_IOS_BANNER_ID || TEST_IDS.ios.banner,
      interstitial: ENV.VITE_ADMOB_IOS_INTERSTITIAL_ID || TEST_IDS.ios.interstitial,
    }
  }
  if (platform === 'android') {
    return {
      banner: ENV.VITE_ADMOB_ANDROID_BANNER_ID || TEST_IDS.android.banner,
      interstitial: ENV.VITE_ADMOB_ANDROID_INTERSTITIAL_ID || TEST_IDS.android.interstitial,
    }
  }
  return null
}

/**
 * True when we're shipping test ad IDs because production IDs aren't
 * configured. Surface this in dev tooling so we don't accidentally
 * ship test inventory to the App Store.
 */
export function isUsingTestIds() {
  const platform = getPlatform()
  if (platform === 'ios') return !ENV.VITE_ADMOB_IOS_BANNER_ID
  if (platform === 'android') return !ENV.VITE_ADMOB_ANDROID_BANNER_ID
  return true
}

// initPromise is the single source of truth for "have we kicked off
// AdMob.initialize() + ATT + UMP yet, and has it settled". showBanner
// and prepareInterstitial both `await` this — so any caller that races
// init (e.g. Discover mounting before the init effect's microtask has
// run) is correctly sequenced. Once set, it's never cleared; init is
// idempotent within a session.
/**
 * Per-request contextual targeting passed into AdMob ad requests. Wired
 * to the native layer via the patched plugin (keywords -> request.keywords
 * / AdRequest.Builder.addKeyword; contentUrl -> request.contentURL /
 * setContentUrl). Built by src/utils/adTargeting.js.
 */
export interface AdTargeting {
  keywords?: string[]
  contentUrl?: string
}

let initPromise: Promise<void> | null = null
let bannerVisible = false
let interstitialPreparing = false
let interstitialReady = false
let lastInterstitialAt = 0
let swipesSinceLastInterstitial = 0

// Latest per-screen targeting, refreshed on each maybeShowInterstitial
// call so background interstitial preloads use the most recent context.
let latestTargeting: AdTargeting | undefined

const MIN_INTERSTITIAL_INTERVAL_MS = 90_000
const SWIPES_PER_INTERSTITIAL = 25

async function getAdMobModule() {
  // Dynamic import so the bundle doesn't pull the native shim on web
  // and so we can no-op cleanly if the plugin isn't installed yet.
  try {
    const mod = await import('@capacitor-community/admob')
    return mod
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[AdMob] plugin not installed or failed to load', err)
    }
    return null
  }
}

/**
 * Initialize the AdMob SDK if we're on native AND the user isn't premium.
 * Safe to call multiple times — only does the real init once. Handles
 * the iOS ATT prompt and the EU/UK UMP consent flow.
 *
 * Pass requestNonPersonalisedAdsOnly:true to opt out of personalisation
 * even where we could legally request it — minimises consent dialog
 * fatigue at the cost of lower CPM.
 */
export function initAdMobIfNeeded(opts: {
  isPremium: boolean
  testDeviceIds?: string[]
} = { isPremium: false }): Promise<void> {
  if (initPromise) return initPromise
  if (!isNative()) return Promise.resolve()
  if (opts.isPremium) return Promise.resolve()

  initPromise = (async () => {
    const adMod = await getAdMobModule()
    if (!adMod) return

    const { AdMob } = adMod

    try {
      await AdMob.initialize({
        testingDevices: opts.testDeviceIds || [],
        initializeForTesting: isUsingTestIds(),
        // Cap programmatic ad creative at PG to match ROAM's 4+ store
        // rating — set globally at init (mirrored by AdMob console
        // content-rating + blocking controls). MaxAdContentRating is a
        // string enum exported by the plugin module.
        maxAdContentRating: adMod.MaxAdContentRating.ParentalGuidance,
      })
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[AdMob] initialize failed', err)
      return
    }

    // iOS ATT — request tracking authorization. On Android this is a no-op.
    try {
      const status = await AdMob.trackingAuthorizationStatus()
      if (status.status === 'notDetermined') {
        // Plugin shows the ATT prompt automatically on first ad request,
        // but we want it to surface early (before the user sees an ad
        // they can't tap). v8 exposes requestTrackingAuthorization.
        const maybeRequest = (AdMob as unknown as {
          requestTrackingAuthorization?: () => Promise<unknown>
        }).requestTrackingAuthorization
        if (typeof maybeRequest === 'function') {
          await maybeRequest()
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[AdMob] ATT check failed', err)
    }

    // UMP — UK/EU consent. SDK decides whether a form is needed based on
    // the user's region. We always request consent info; SDK is a no-op
    // outside the EEA/UK.
    try {
      const consent = await AdMob.requestConsentInfo()
      if (
        consent &&
        typeof consent === 'object' &&
        'isConsentFormAvailable' in consent &&
        (consent as { isConsentFormAvailable: boolean }).isConsentFormAvailable &&
        'status' in consent &&
        (consent as { status: string }).status === 'REQUIRED'
      ) {
        await AdMob.showConsentForm()
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[AdMob] consent flow failed', err)
    }
  })()

  return initPromise
}

/**
 * Show the AdMob banner overlay at the bottom of the screen. Idempotent.
 *
 * Waits for `initAdMobIfNeeded()` to settle before requesting an ad — on
 * cold start the banner effect in `useAdMob` and the init effect both
 * run on Discover mount, but the showBanner call can resolve a tick
 * earlier than init. The await here keeps SDK init + ATT/UMP consent
 * gating ahead of the first ad request.
 */
export async function showBanner(targeting?: AdTargeting) {
  if (!isNative()) return
  await initAdMobIfNeeded({ isPremium: false })
  if (bannerVisible) return
  const ids = unitIds()
  if (!ids) return

  const adMod = await getAdMobModule()
  if (!adMod) return
  const { AdMob, BannerAdPosition, BannerAdSize } = adMod

  try {
    await AdMob.showBanner({
      adId: ids.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      // Lift the banner above ROAM's own bottom nav (~64px). Android
      // stacks the system gesture/nav bar below ours, so the plugin's
      // BOTTOM_CENTER anchor needs more clearance there or the banner
      // overlaps the tab bar (reported in the wild). iOS was fine at 64.
      margin: getPlatform() === 'android' ? 100 : 64,
      isTesting: isUsingTestIds(),
      ...(targeting?.keywords?.length ? { keywords: targeting.keywords } : {}),
      ...(targeting?.contentUrl ? { contentUrl: targeting.contentUrl } : {}),
    })
    bannerVisible = true
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[AdMob] showBanner failed', err)
  }
}

export async function hideBanner() {
  if (!isNative()) return
  if (!bannerVisible) return

  const adMod = await getAdMobModule()
  if (!adMod) return

  try {
    await adMod.AdMob.hideBanner()
    bannerVisible = false
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[AdMob] hideBanner failed', err)
  }
}

/**
 * Background-load an interstitial so it's ready when we want to show it.
 * Called automatically after each show, and on init.
 */
async function prepareInterstitial() {
  if (!isNative()) return
  // Same init-gate as showBanner — never request an ad before
  // AdMob.initialize() + ATT/UMP have run.
  await initAdMobIfNeeded({ isPremium: false })
  if (interstitialPreparing || interstitialReady) return
  const ids = unitIds()
  if (!ids) return

  const adMod = await getAdMobModule()
  if (!adMod) return

  interstitialPreparing = true
  try {
    await adMod.AdMob.prepareInterstitial({
      adId: ids.interstitial,
      isTesting: isUsingTestIds(),
      ...(latestTargeting?.keywords?.length ? { keywords: latestTargeting.keywords } : {}),
      ...(latestTargeting?.contentUrl ? { contentUrl: latestTargeting.contentUrl } : {}),
    })
    interstitialReady = true
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[AdMob] prepareInterstitial failed', err)
  } finally {
    interstitialPreparing = false
  }
}

/**
 * Called after each swipe in the deck. Increments the counter, and when
 * we've crossed BOTH the per-swipe and time-based thresholds, shows the
 * interstitial. Cheap to call on every swipe.
 */
export async function maybeShowInterstitial({ isPremium, targeting }: { isPremium: boolean; targeting?: AdTargeting }) {
  if (isPremium) return
  if (!isNative()) return

  if (targeting) latestTargeting = targeting

  swipesSinceLastInterstitial += 1
  if (swipesSinceLastInterstitial < SWIPES_PER_INTERSTITIAL) {
    // Preload in advance so it's ready when the threshold hits.
    if (swipesSinceLastInterstitial === SWIPES_PER_INTERSTITIAL - 3) {
      prepareInterstitial().catch(() => {})
    }
    return
  }

  const now = Date.now()
  if (now - lastInterstitialAt < MIN_INTERSTITIAL_INTERVAL_MS) return

  if (!interstitialReady) {
    // Try to prep now; will show next eligible swipe.
    prepareInterstitial().catch(() => {})
    return
  }

  const adMod = await getAdMobModule()
  if (!adMod) return

  try {
    await adMod.AdMob.showInterstitial()
    lastInterstitialAt = now
    swipesSinceLastInterstitial = 0
    interstitialReady = false
    // Preload the next one in the background.
    prepareInterstitial().catch(() => {})
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[AdMob] showInterstitial failed', err)
  }
}

/**
 * Reset internal frequency-cap state. Use when the user upgrades to
 * premium mid-session and we want to make sure we never show another ad.
 */
export function resetAdMobState() {
  swipesSinceLastInterstitial = 0
  interstitialReady = false
  hideBanner().catch(() => {})
}

export default {
  initAdMobIfNeeded,
  showBanner,
  hideBanner,
  maybeShowInterstitial,
  resetAdMobState,
  isUsingTestIds,
}
