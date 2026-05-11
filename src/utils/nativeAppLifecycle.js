/**
 * Capacitor App lifecycle wiring.
 *
 * Currently a thin scaffold — Stage 4 (native plugin swaps) will fill
 * this in with deep-link routing and pause/resume behaviour. Splitting
 * it out now so:
 *   1. main.jsx stays clean
 *   2. Future Capacitor plugin imports are isolated to this module,
 *      meaning Vite tree-shakes the entire @capacitor/* surface out
 *      of the web bundle when isNative() === false
 *
 * Listeners we'll wire in Stage 4:
 *   - 'appUrlOpen' → deep-link handler routes /place/:id, /user/:username,
 *     etc. into react-router. Requires Apple AASA / Android assetlinks.json.
 *   - 'appStateChange' → on foreground, refresh place data, refresh
 *     auth (Apple session expires after 6 months idle).
 *   - 'backButton' (Android) → react-router back navigation, double-back
 *     to exit.
 */

import { isNative } from './nativeBridge'
import { configureStatusBar, configureKeyboard, hideSplashScreen } from './nativePlugins'
import { initRevenueCat } from './revenueCat'

let initialized = false

export async function initNativeAppLifecycle() {
  if (initialized) return
  initialized = true
  if (!isNative()) return

  // Brand the status bar + keyboard up-front so the splash hand-off
  // looks branded, not default-iOS-grey. RevenueCat init happens in
  // parallel — it's quick (~100ms) and the SDK must be configured
  // before any Pricing screen mount tries to fetch offerings.
  await Promise.all([configureStatusBar(), configureKeyboard(), initRevenueCat()])

  try {
    const { App } = await import('@capacitor/app')

    App.addListener('appStateChange', ({ isActive }) => {
      window.dispatchEvent(new CustomEvent(
        isActive ? 'roam-app-foreground' : 'roam-app-background'
      ))
    })

    // Android hardware back button. Capacitor's default behaviour is
    // to exit the app on every press — disastrous for a multi-route
    // app. Wire it through react-router: pop history if there's a
    // page to go back to, otherwise let Capacitor exit. (iOS has no
    // hardware back button so this is a no-op there at runtime.)
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack || window.history.length > 1) {
        window.history.back()
      } else {
        App.exitApp()
      }
    })

    // Deep-link handler: routes Universal Links (iOS) / App Links
    // (Android) into react-router. Requires apple-app-site-association
    // and Android assetlinks.json files at /.well-known/ on go-roam.uk
    // (separate task — see Stage 6).
    App.addListener('appUrlOpen', (event) => {
      try {
        const url = new URL(event.url)
        // Strip the origin so we get a router-compatible path
        const path = url.pathname + url.search + url.hash
        window.dispatchEvent(new CustomEvent('roam-app-url-open', {
          detail: { url: event.url, path }
        }))
      } catch (err) {
        console.warn('Invalid deep link URL:', event.url, err)
      }
    })

    // Hand off splash → React. We ask for splash hide on the next
    // animation frame after this init completes, giving React enough
    // time to render the first screen behind the splash.
    requestAnimationFrame(() => {
      void hideSplashScreen()
    })
  } catch (err) {
    console.warn('Capacitor App listeners failed to init', err)
  }
}

export default { initNativeAppLifecycle }
