/**
 * The plan being built, kept in localStorage so it survives leaving the
 * page (signed-out users have nowhere else to keep it). Cleared once the
 * plan is saved to an account, on sign-out (shared devices), and ignored
 * once it's a day old (its stop times are stale by then).
 */

export const DRAFT_KEY = 'roam_plan_draft'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (!draft || !Array.isArray(draft.itinerary)) return null
    if (!draft.savedAt || Date.now() - draft.savedAt > MAX_AGE_MS) return null
    const { savedAt: _savedAt, ...rest } = draft
    return rest
  } catch {
    return null
  }
}

export function writeDraft(draft) {
  try {
    if (!draft || !draft.itinerary?.length) localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }))
  } catch {
    // Storage full or blocked: the plan still works for this visit
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Storage blocked
  }
}
