// Ask for an App Store / Play rating at a happy moment: after someone
// finishes marking a visit they loved. Ratings drive store ranking and
// installs. Native only, and deliberately rare: from the 2nd loved visit,
// at most once per 120 days (the OS applies its own cap on top, e.g. iOS 3/yr).
import { isNative } from './nativeBridge'
import { track } from './analytics'

const LOVED_KEY = 'roam_loved_visits'
const ASKED_KEY = 'roam_review_asked_at'
const MIN_LOVED = 2
const GAP_MS = 120 * 24 * 60 * 60 * 1000

export function shouldAskForReview({ lovedVisits, lastAskedAt, now = Date.now() }) {
  return lovedVisits >= MIN_LOVED && (!lastAskedAt || now - lastAskedAt >= GAP_MS)
}

/** Call when the user closes the success screen of a visit they loved. */
export async function afterLovedVisit() {
  if (!isNative()) return false
  try {
    const lovedVisits = Number(localStorage.getItem(LOVED_KEY) || 0) + 1
    localStorage.setItem(LOVED_KEY, String(lovedVisits))
    const lastAskedAt = Number(localStorage.getItem(ASKED_KEY) || 0)
    if (!shouldAskForReview({ lovedVisits, lastAskedAt })) return false
    const { InAppReview } = await import('@capacitor-community/in-app-review')
    await InAppReview.requestReview()
    // Only after it worked: a build without the plugin must not mute this for 120 days
    localStorage.setItem(ASKED_KEY, String(Date.now()))
    track('review_prompt_requested', { lovedVisits })
    return true
  } catch {
    return false // storage blocked or plugin missing: never break closing the sheet
  }
}
