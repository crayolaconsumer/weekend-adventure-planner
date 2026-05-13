/**
 * Stats / streak update helpers used by Discover's "went out" actions.
 *
 * Extracted to keep the page component focused on rendering and to make
 * the streak-rollover math testable in isolation. The streak rule mirrors
 * the one in UnifiedProfile/utils.loadStatsFromStorage so the two
 * surfaces stay consistent: if the user "went out" today and yesterday,
 * the streak increments; if there's a gap of more than one day it resets
 * to 1 on the new "went out" event.
 */

export interface PersistedStats {
  currentStreak?: number
  bestStreak?: number
  lastStreakDate?: string
  timesWentOut?: number
  justGoUses?: number
  [key: string]: unknown
}

export interface StreakResult {
  currentStreak: number
  bestStreak: number
}

/**
 * Compute the updated streak based on lastStreakDate.
 *
 *   - today        → no change, already counted
 *   - yesterday    → +1 to current; bump bestStreak if needed
 *   - older / null → reset current to 1
 *
 * `now` is injected so the helper can be tested deterministically.
 */
export function computeStreakRollover(
  stats: PersistedStats,
  now: Date = new Date(),
): StreakResult {
  const today = now.toDateString()
  const lastDate = stats.lastStreakDate
  let currentStreak = stats.currentStreak || 0
  let bestStreak = stats.bestStreak || 0

  if (lastDate !== today) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    currentStreak = lastDate === yesterday.toDateString() ? currentStreak + 1 : 1
    bestStreak = Math.max(bestStreak, currentStreak)
  }

  return { currentStreak, bestStreak }
}

export interface WentOutOptions {
  /** Also bump justGoUses (true for "Just Go" modal, false for direct go button). */
  fromJustGo?: boolean
}

/**
 * Build the patch object to pass to updateStats() when the user
 * "goes out" to a place.
 */
export function buildWentOutPatch(
  stats: PersistedStats,
  options: WentOutOptions = {},
  now: Date = new Date(),
): PersistedStats {
  const { currentStreak, bestStreak } = computeStreakRollover(stats, now)

  const patch: PersistedStats = {
    timesWentOut: (stats.timesWentOut || 0) + 1,
    lastActivityDate: now.toISOString(),
    currentStreak,
    bestStreak,
    lastStreakDate: now.toDateString(),
  }

  if (options.fromJustGo) {
    patch.justGoUses = (stats.justGoUses || 0) + 1
  }

  return patch
}

/**
 * Read current stats from localStorage. Tolerates missing / corrupt JSON.
 */
export function readPersistedStats(): PersistedStats {
  try {
    return JSON.parse(localStorage.getItem('roam_stats') || '{}') as PersistedStats
  } catch {
    return {}
  }
}
