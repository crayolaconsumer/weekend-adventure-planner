/**
 * Affiliate link wrapper for outbound event/ticket URLs.
 *
 * Strategy: detect the destination (Ticketmaster, Skiddle, Eventbrite, etc.)
 * and append the right affiliate tracking based on which network you've
 * been approved into. Until the env var for a given network is set, the
 * URL passes through untouched — no half-wired tracking, no broken links.
 *
 * Where to sign up:
 *   - AWIN (UK aggregator covering Ticketmaster UK, Booking, RailEurope,
 *     etc.): https://www.awin.com — single application, fastest payout.
 *   - Skiddle direct affiliates: https://www.skiddle.com/promoters/affiliate.php
 *   - Impact Radius (Ticketmaster + Live Nation direct, higher bar):
 *     https://app.impact.com
 *   - Eventbrite via AWIN or direct: https://www.eventbrite.com/l/affiliates/
 *
 * After signing up, set the relevant env vars in Vercel and the local .env:
 *   VITE_AWIN_PUBLISHER_ID         — AWIN publisher ID (numeric)
 *   VITE_SKIDDLE_AFFILIATE_ID      — Skiddle ref code
 *   VITE_TICKETMASTER_IMPACT_ID    — Impact partner ID for Ticketmaster
 */

const IDS = {
  awin: import.meta.env.VITE_AWIN_PUBLISHER_ID || null,
  skiddle: import.meta.env.VITE_SKIDDLE_AFFILIATE_ID || null,
  ticketmasterImpact: import.meta.env.VITE_TICKETMASTER_IMPACT_ID || null,
}

const TM_HOSTS = ['ticketmaster.co.uk', 'ticketmaster.com', 'ticketmaster.ie']
const SKIDDLE_HOSTS = ['skiddle.com', 'www.skiddle.com']
const EVENTBRITE_HOSTS = ['eventbrite.co.uk', 'eventbrite.com', 'www.eventbrite.co.uk']

function detectSource(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (TM_HOSTS.some(h => host.endsWith(h))) return 'ticketmaster'
    if (SKIDDLE_HOSTS.some(h => host.endsWith(h))) return 'skiddle'
    if (EVENTBRITE_HOSTS.some(h => host.endsWith(h))) return 'eventbrite'
    return null
  } catch {
    return null
  }
}

function appendQuery(url, params) {
  try {
    const u = new URL(url)
    for (const [k, v] of Object.entries(params)) {
      if (v != null && !u.searchParams.has(k)) u.searchParams.set(k, v)
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Wrap an outbound URL with the affiliate tracking we're approved for.
 * Idempotent — calling twice won't double-append. Safe to call with any URL.
 *
 * @param {string} url - The destination URL
 * @param {string} [explicitSource] - Force a particular source (e.g. when
 *   the URL comes from our own API and we know what produced it)
 * @returns {string}
 */
export function withAffiliate(url, explicitSource = null) {
  if (!url || typeof url !== 'string') return url
  const source = explicitSource || detectSource(url)
  if (!source) return url

  if (source === 'awin' && IDS.awin) {
    return `https://www.awin1.com/cread.php?awinmid=${IDS.awin}&ued=${encodeURIComponent(url)}`
  }

  if (source === 'ticketmaster' && IDS.ticketmasterImpact) {
    return appendQuery(url, {
      irgwc: '1',
      clickid: IDS.ticketmasterImpact,
      utm_source: 'roam',
      utm_medium: 'affiliate',
    })
  }

  if (source === 'skiddle' && IDS.skiddle) {
    return appendQuery(url, { ref: IDS.skiddle })
  }

  return url
}

/**
 * True if at least one affiliate network is configured. Useful for
 * showing "Earn us a small commission" disclosure copy only when we
 * actually earn one.
 */
export function hasAnyAffiliate() {
  return Boolean(IDS.awin || IDS.skiddle || IDS.ticketmasterImpact)
}

export default withAffiliate
