/**
 * Product Analytics — PostHog
 *
 * Activates only when VITE_POSTHOG_KEY is set. PostHog is lazy-imported
 * (dynamic import inside init), so without the key the library never
 * gets fetched — zero bundle weight.
 *
 * Deliberately small surface — `track` for explicit events, plus identify/
 * reset for auth lifecycle. PostHog's $autocapture handles clicks and
 * pageviews automatically, so don't track those manually.
 *
 * Usage:
 *   1. Sign up at posthog.com (free tier covers ~1M events/month)
 *   2. Vercel → Settings → Env Vars → VITE_POSTHOG_KEY (project key)
 *   3. Optionally VITE_POSTHOG_HOST (defaults to EU cloud)
 *   4. Redeploy.
 */

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.posthog.com'

let initPromise = null

/**
 * Initialize PostHog. Returns a promise that resolves when ready or null.
 * Safe to call multiple times — subsequent calls reuse the first init.
 */
export function initAnalytics() {
  if (!POSTHOG_KEY) return null
  if (initPromise) return initPromise

  initPromise = import('posthog-js').then((mod) => {
    const ph = mod.default
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: {
        element_attribute_ignorelist: ['data-no-analytics'],
      },
      persistence: 'localStorage+cookie',
      respect_dnt: true,
      loaded: (instance) => {
        if (import.meta.env.DEV && !import.meta.env.VITE_POSTHOG_DEV) {
          instance.opt_out_capturing()
        }
      },
    })
    return ph
  }).catch((err) => {
    console.warn('PostHog failed to load:', err)
    return null
  })

  return initPromise
}

/**
 * Identify the current user. Safe to call before init resolves —
 * queues until ready.
 */
export function identify(userId, traits = {}) {
  if (!POSTHOG_KEY) return
  void initAnalytics()?.then((ph) => ph?.identify(String(userId), traits))
}

/**
 * Clear identity + reset device id. Call on logout.
 */
export function resetAnalytics() {
  if (!POSTHOG_KEY) return
  void initAnalytics()?.then((ph) => ph?.reset())
}

/**
 * Track a named event with optional properties.
 * Keep names lowercase-hyphenated for grep-ability.
 *
 * Canonical events (extend as needed):
 *   - 'signed-up'                  { method: 'email' | 'google' }
 *   - 'place-saved'                { placeId, category }
 *   - 'place-visited'              { placeId, recommended, hasDistance }
 *   - 'share-clicked'              { entity, id }
 *   - 'upgrade-clicked'            { plan, surface, authed }
 *   - 'upgrade-completed'          { plan }
 *   - 'offline-pack-downloaded'    { radiusKm, byteSize, placeCount }
 */
export function track(event, properties = {}) {
  if (!POSTHOG_KEY) return
  void initAnalytics()?.then((ph) => ph?.capture(event, properties))
}

/**
 * Set persistent user properties without re-identifying — useful for
 * tracking subscription state changes etc.
 */
export function setUserProperties(properties = {}) {
  if (!POSTHOG_KEY) return
  void initAnalytics()?.then((ph) => ph?.people.set(properties))
}

export default {
  initAnalytics,
  identify,
  resetAnalytics,
  track,
  setUserProperties,
}
