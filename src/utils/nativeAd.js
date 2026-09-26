/**
 * Native ad card bridge: thin wrapper over the local RoamNativeAd
 * Capacitor plugin (iOS + Android). The native side draws a ROAM-framed
 * AdMob native ad over the WebView at a rect we pass, handles the drag,
 * and tells us when it has been swiped away. Web has no such plugin.
 *
 * Ad unit IDs (build-time env, Google test IDs until set):
 *   VITE_ADMOB_IOS_NATIVE_ID
 *   VITE_ADMOB_ANDROID_NATIVE_ID
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNative, getPlatform } from './nativeBridge'
import { ensureAdConsent } from './adMob'
import { track } from './analytics'

// https://developers.google.com/admob/ios/test-ads
// https://developers.google.com/admob/android/test-ads
const TEST_IDS = {
  ios: 'ca-app-pub-3940256099942544/3986624511',
  android: 'ca-app-pub-3940256099942544/2247696110',
}

const RoamNativeAd = registerPlugin('RoamNativeAd')

// Old app builds lack the plugin: no ad cards, no errors.
export function isNativeAdAvailable() {
  return isNative() && Capacitor.isPluginAvailable('RoamNativeAd')
}

function adUnitId() {
  const env = import.meta.env
  return getPlatform() === 'ios'
    ? env.VITE_ADMOB_IOS_NATIVE_ID || TEST_IDS.ios
    : env.VITE_ADMOB_ANDROID_NATIVE_ID || TEST_IDS.android
}

let analyticsWired = false
function wireAnalytics() {
  if (analyticsWired) return
  analyticsWired = true
  const platform = getPlatform()
  RoamNativeAd.addListener('adClicked', () => track('ad_card_clicked', { platform })).catch(() => {})
  RoamNativeAd.addListener('adImpression', () => track('ad_card_impression', { platform })).catch(() => {})
}

/**
 * Resolves once an ad is held for `slot`; rejects on no fill or error.
 * isPremium must be the caller's noAds gate: ad-free users never request.
 */
// A load refused before any request (ad-free user, no consent) is not a
// no-fill: err.refused lets the deck collapse the slot without reporting it
function refused(message) {
  const err = new Error(message)
  err.refused = true
  return err
}

export async function loadNativeAd(slot, { isPremium }) {
  if (isPremium) throw refused('ad-free user')
  // Init + UMP consent + ATT always run before the first request; no
  // consent (or consent still unknown after a retry) means no request
  if (!(await ensureAdConsent())) throw refused('consent does not allow ads')
  wireAnalytics()
  return RoamNativeAd.load({ slot, adUnitId: adUnitId() })
}

export const showNativeAd = (opts) => RoamNativeAd.show(opts)
export const hideNativeAd = (slot) => RoamNativeAd.hide({ slot })
export const destroyNativeAd = (slot) => RoamNativeAd.destroy({ slot })

// A native ad card is on screen: useAdMob hides the banner meanwhile.
export const AD_CARD_EVENT = 'roam-ad-card'
let adCardActive = false
export const isAdCardActive = () => adCardActive
export function setAdCardActive(active) {
  if (adCardActive === active) return
  adCardActive = active
  window.dispatchEvent(new CustomEvent(AD_CARD_EVENT, { detail: { active } }))
}

/** cb({ slot, direction }) fires after the card has flown off and been destroyed. Returns a Promise<handle>. */
export const onNativeAdDismissed = (cb) => RoamNativeAd.addListener('adDismissed', cb)
