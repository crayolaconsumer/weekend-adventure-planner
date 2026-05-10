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

let initialized = false

export async function initNativeAppLifecycle() {
  if (initialized) return
  initialized = true
  if (!isNative()) return

  try {
    const { App } = await import('@capacitor/app')

    // Foreground / background — useful for refreshing stale data.
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        // Stage 4: refresh user, refetch trending, etc.
        window.dispatchEvent(new CustomEvent('roam-app-foreground'))
      } else {
        window.dispatchEvent(new CustomEvent('roam-app-background'))
      }
    })

    // Universal links / app links — Stage 4 wires the actual router.
    App.addListener('appUrlOpen', (event) => {
      // event.url is the full URL the OS handed off — e.g.
      // "https://go-roam.uk/place/12345"
      window.dispatchEvent(new CustomEvent('roam-app-url-open', {
        detail: { url: event.url }
      }))
    })
  } catch (err) {
    console.warn('Capacitor App listeners failed to init', err)
  }
}

export default { initNativeAppLifecycle }
