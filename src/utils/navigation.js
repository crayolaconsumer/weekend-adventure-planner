/**
 * Navigation Utilities
 * Handles opening external links, especially maps/directions
 */

import { isNative, getPlatform } from './nativeBridge'

/**
 * Which maps app a directions link should target.
 * 'ios' → Apple Maps, 'android' → Google Maps app, 'web' → Google Maps web.
 * iPadOS Safari reports a Mac UA, so a touch-capable "Mac" counts as iOS.
 */
export function mapsPlatform() {
  if (isNative()) return getPlatform() === 'ios' ? 'ios' : 'android'
  if (typeof navigator === 'undefined') return 'web'
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'web'
}

const point = (p) => (typeof p === 'string' ? p : `${p.lat},${p.lng}`)
const APPLE_DIRFLG = { walk: 'w', drive: 'd', transit: 'r' }
const GOOGLE_TRAVELMODE = { walk: 'walking', drive: 'driving', transit: 'transit' }

/**
 * Directions URL for the platform's maps app.
 *
 * @param {Object} opts
 * @param {{lat:number,lng:number}|string} opts.to - destination (coords or address)
 * @param {{lat:number,lng:number}} [opts.from] - origin; omitted = "here"
 * @param {Array<{lat:number,lng:number}>} [opts.via] - intermediate stops
 * @param {'walk'|'drive'|'transit'} [opts.mode] - omitted = the app's default
 * @param {'ios'|'android'|'web'} [platform]
 *
 * Apple Maps (documented Map Links params daddr/saddr/dirflg) takes one
 * destination only, so multi-stop routes stay on Google Maps everywhere;
 * on iPhone that universal link opens the Google Maps app if installed,
 * otherwise Google Maps in Safari.
 */
export function directionsUrl({ to, from, via = [], mode } = {}, platform = mapsPlatform()) {
  if (platform === 'ios' && via.length === 0) {
    const url = new URL('https://maps.apple.com/')
    if (from) url.searchParams.set('saddr', point(from))
    url.searchParams.set('daddr', point(to))
    if (APPLE_DIRFLG[mode]) url.searchParams.set('dirflg', APPLE_DIRFLG[mode])
    return url.toString()
  }
  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  if (from) url.searchParams.set('origin', point(from))
  url.searchParams.set('destination', point(to))
  if (via.length) url.searchParams.set('waypoints', via.map(point).join('|'))
  if (GOOGLE_TRAVELMODE[mode]) url.searchParams.set('travelmode', GOOGLE_TRAVELMODE[mode])
  return url.toString()
}

/**
 * Hand directions off to the platform's maps app.
 *
 * Native: a top-level navigation to an outside host is handed to the OS by
 * Capacitor (iOS UIApplication.open, Android ACTION_VIEW intent), which is
 * what opens Apple Maps / the Google Maps app, and the app stays loaded.
 * The in-app Browser plugin would load the web page instead.
 * Web (phone and desktop): a new tab, never same-window, so an unsaved plan
 * or any other in-memory state survives. Safari / Chrome still hand the
 * maps link to the maps app from the new tab.
 */
export function openMapsDirections(opts) {
  const url = directionsUrl(opts)
  if (isNative()) {
    window.location.href = url
  } else {
    window.open(url, '_blank', 'noopener')
  }
  return url
}

/**
 * Open directions to a location in the platform's maps app.
 * Kept for existing callers; `name` is unused (Google's destination_place_id
 * wants a Google place id, not a name, and Apple has no label param).
 *
 * @param {number} lat - Destination latitude
 * @param {number} lng - Destination longitude
 * @param {string} [_name]
 * @param {'walk'|'drive'|'transit'} [mode]
 */
export function openDirections(lat, lng, _name = null, mode) {
  return openMapsDirections({ to: { lat, lng }, mode })
}

/**
 * Open a URL externally — out of the Capacitor WebView on native, new tab
 * on web. Was `window.open(url, '_blank')` which on iOS Capacitor opens
 * INSIDE the app's webview context, so e.g. apps.apple.com/account/
 * subscriptions didn't deep-link into the iOS Subscriptions UI and Safari
 * couldn't take over. Now uses the Capacitor Browser plugin which routes
 * through SFSafariViewController (iOS) / Custom Tabs (Android) and lets
 * the OS handle protocol-specific URLs (apps.apple.com → Settings,
 * itms-apps:// etc.) — required for App Store Review 3.1.2's one-tap
 * Manage Subscription path.
 *
 * @param {string} url - URL to open
 */
export async function openExternalLink(url) {
  const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
  if (isNative) {
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
      return
    } catch (err) {
      // Fall through to window.open if the plugin import fails — better
      // to open something than nothing.
      console.warn('[openExternalLink] Capacitor Browser failed, falling back:', err?.message)
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
