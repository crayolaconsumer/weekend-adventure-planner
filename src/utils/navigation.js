/**
 * Navigation Utilities
 * Handles opening external links, especially maps/directions
 */

/**
 * Detect if running on a mobile device
 */
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
}

/**
 * Open Google Maps directions to a location
 * On mobile: Uses location.href to properly trigger native Maps app
 * On desktop: Opens in new tab
 *
 * @param {number} lat - Destination latitude
 * @param {number} lng - Destination longitude
 * @param {string} [name] - Optional place name for better UX
 */
export function openDirections(lat, lng, name = null) {
  // Build the URL with optional place name for better display
  let url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  if (name) {
    url += `&destination_place_id=${encodeURIComponent(name)}`
  }

  if (isMobileDevice()) {
    // On mobile, navigate in same window to properly trigger native app
    // The user will return to our app via browser history/back
    window.location.href = url
  } else {
    // On desktop, open in new tab
    window.open(url, '_blank')
  }
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
