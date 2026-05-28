/**
 * Google AdSense — web-only ad serving for free users.
 *
 * Approval flow: apply at https://www.google.com/adsense after the
 * domain has real traffic. Google reviews go-roam.uk for policy
 * compliance (1-4 weeks typical). Once approved, set the env var below
 * and ads start serving in the reserved slot.
 *
 * Until then:
 *   - The script tag is NOT injected (no network noise, no consent
 *     issues, no policy risk).
 *   - AdBanner renders a zero-height placeholder so the layout doesn't
 *     shift when ads eventually appear.
 *
 * Env vars (Vite — exposed to client):
 *   VITE_ADSENSE_CLIENT_ID   — your AdSense publisher ID (ca-pub-…)
 *   VITE_ADSENSE_SLOT_BANNER — the ad unit slot ID for the banner slot
 */

const CLIENT_ID = import.meta.env.VITE_ADSENSE_CLIENT_ID || null
export const ADSENSE_SLOT_BANNER = import.meta.env.VITE_ADSENSE_SLOT_BANNER || null

let scriptInjected = false

export function isAdSenseConfigured() {
  return Boolean(CLIENT_ID)
}

export function getAdSenseClientId() {
  return CLIENT_ID
}

/**
 * Lazy-inject the AdSense script tag. Call this AFTER the user has
 * granted consent (or in regions where consent isn't required and the
 * user isn't premium). Idempotent.
 */
export function injectAdSenseScript() {
  if (scriptInjected) return
  if (!CLIENT_ID) return
  if (typeof document === 'undefined') return

  scriptInjected = true
  const script = document.createElement('script')
  script.async = true
  script.crossOrigin = 'anonymous'
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT_ID)}`
  document.head.appendChild(script)
}

/**
 * Push a new ad slot into the AdSense queue. Call once per <ins> element
 * after it's mounted.
 */
export function pushAdSlot() {
  if (typeof window === 'undefined') return
  if (!CLIENT_ID) return
  try {
    const w = window
    w.adsbygoogle = w.adsbygoogle || []
    w.adsbygoogle.push({})
  } catch (err) {
    // AdSense throws if pushed before script loaded — safe to ignore;
    // the next push will re-attempt.
    if (import.meta.env.DEV) console.warn('[AdSense] push failed', err)
  }
}

export default {
  isAdSenseConfigured,
  injectAdSenseScript,
  pushAdSlot,
}
