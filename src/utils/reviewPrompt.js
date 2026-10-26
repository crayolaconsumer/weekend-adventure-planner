// Ask for an App Store / Play rating at happy moments: a place saved, a plan
// saved, a visit marked or loved. Ratings drive store ranking and installs.
//
// Store rules: no "Enjoying ROAM?" pre-prompt (Play bans review gating) and
// only the native API (Apple requires SKStoreReviewController). So we just
// call InAppReview.requestReview() at a good moment and the OS decides whether
// to show it, with its own quota on top (e.g. iOS 3/yr).
//
// Rule: native, >= 3 happy moments, on >= 2 distinct calendar days, and no
// successful request in the last 120 days.
import { isNative } from './nativeBridge'
import { track } from './analytics'

const MOMENTS_KEY = 'roam_happy_moments' // { count, days: ['YYYY-MM-DD', ...] }
const ASKED_KEY = 'roam_review_asked_at'
const MIN_MOMENTS = 3
const MIN_DAYS = 2
const MAX_DAYS_KEPT = 7 // only "at least 2" matters; keep the list tiny
const GAP_MS = 120 * 24 * 60 * 60 * 1000

let inFlight = false // two moments at once must not both reach requestReview

export function shouldAskForReview({ moments, activeDays, lastAskedAt, now = Date.now() }) {
  return moments >= MIN_MOMENTS && activeDays >= MIN_DAYS && (!lastAskedAt || now - lastAskedAt >= GAP_MS)
}

// Local calendar day, so "two days" means what the user thinks it means
function dayKey(now) {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * Call (without awaiting) right after a happy action succeeded.
 * kind: 'loved_visit' | 'plan_saved' | 'place_saved' | 'visit_marked'.
 * Resolves true only if the native review request was made. Never throws.
 */
export async function recordHappyMoment(kind, now = Date.now(), { count = true } = {}) {
  if (!isNative()) return false
  try {
    let state = JSON.parse(localStorage.getItem(MOMENTS_KEY) || 'null')
    if (!state || !Array.isArray(state.days)) state = { count: 0, days: [] }
    const today = dayKey(now)
    const days = !count || state.days.includes(today) ? state.days : [...state.days, today].slice(-MAX_DAYS_KEPT)
    const moments = (Number(state.count) || 0) + (count ? 1 : 0)
    if (count) localStorage.setItem(MOMENTS_KEY, JSON.stringify({ count: moments, days }))

    const lastAskedAt = Number(localStorage.getItem(ASKED_KEY) || 0)
    if (inFlight || !shouldAskForReview({ moments, activeDays: days.length, lastAskedAt, now })) return false
    inFlight = true
    try {
      const { InAppReview } = await import('@capacitor-community/in-app-review')
      await InAppReview.requestReview()
    } finally {
      inFlight = false
    }
    // Only after it worked: a build without the plugin must not mute this for 120 days
    localStorage.setItem(ASKED_KEY, String(now))
    track('review_prompt_requested', { trigger: kind, moments, activeDays: days.length })
    return true
  } catch {
    return false // storage blocked or plugin missing: never break the user's action
  }
}

/**
 * Call when the user closes the success screen of a visit they loved. The visit
 * itself was already counted (visit_marked), so this adds nothing to the tally:
 * it only uses the happy moment to ask, if the rule is already met.
 */
export function afterLovedVisit(now = Date.now()) {
  return recordHappyMoment('loved_visit', now, { count: false })
}
