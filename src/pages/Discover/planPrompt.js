/**
 * When to show the full-screen "Plan adventure" prompt after a save.
 *
 * Not on the first save: a brand-new user gets a light "Saved" toast and
 * keeps swiping. The prompt first appears on the 3rd save, when there is
 * something worth planning around. After that it only returns once a week
 * AND after 5 more saves, and at most once per session.
 */

export const PLAN_PROMPT_FIRST_SAVE = 3
const COOL_DOWN_DAYS = 7
const COOL_DOWN_SAVES = 5

export function shouldShowPlanPrompt({ totalSaves, lastShownAt = 0, savesAtLastShow = 0, sessionShown = false, now = Date.now() }) {
  if (sessionShown) return false
  if (lastShownAt === 0) return totalSaves >= PLAN_PROMPT_FIRST_SAVE
  const daysSinceLastShow = (now - lastShownAt) / 86400000
  return daysSinceLastShow >= COOL_DOWN_DAYS && totalSaves - savesAtLastShow >= COOL_DOWN_SAVES
}
