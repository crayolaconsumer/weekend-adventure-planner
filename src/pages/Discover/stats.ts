/**
 * Stats / streak update helpers used by Discover's "went out" + "just go"
 * actions. Extracted so the streak-rollover math is testable in isolation
 * and so both call sites (Let's Go swipe + Just Go modal) produce
 * identical updates.
 *
 * Field names match the new server-side user_stats columns
 * (boredomBusts, lastActivityAt, lastStreakDate as ISO) so updateStats()
 * passes them through the whitelist unchanged.
 */

export interface PersistedStats {
  currentStreak?: number
  bestStreak?: number
  lastStreakDate?: string
  timesWentOut?: number
  boredomBusts?: number
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
  const todayStr = now.toDateString()
  const lastStr = stats.lastStreakDate ? new Date(stats.lastStreakDate).toDateString() : null
  let currentStreak = stats.currentStreak || 0
  let bestStreak = stats.bestStreak || 0

  if (lastStr !== todayStr) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    currentStreak = lastStr === yesterday.toDateString() ? currentStreak + 1 : 1
    bestStreak = Math.max(bestStreak, currentStreak)
  }

  return { currentStreak, bestStreak }
}

export interface WentOutOptions {
  /** Also bump boredomBusts (true for "Just Go" modal, false for direct go). */
  fromJustGo?: boolean
}

/**
 * Build the patch object to pass to updateStats() when the user
 * "goes out" to a place. Caller MUST pass `stats` from the
 * useUserStats hook so the patch is computed against the same source
 * of truth that updateStats() will write to. Previously this helper
 * bypassed useUserStats and read directly from localStorage which
 * meant authenticated users on a fresh device would compute against
 * empty data even though the server had their real numbers.
 */
export function buildWentOutPatch(
  stats: PersistedStats,
  options: WentOutOptions = {},
  now: Date = new Date(),
): PersistedStats {
  const { currentStreak, bestStreak } = computeStreakRollover(stats, now)

  const patch: PersistedStats = {
    timesWentOut: (stats.timesWentOut || 0) + 1,
    lastActivityAt: now.toISOString(),
    currentStreak,
    bestStreak,
    // ISO so server's DATE column parses correctly; mysql2 coerces.
    lastStreakDate: now.toISOString(),
  }

  if (options.fromJustGo) {
    patch.boredomBusts = (stats.boredomBusts || 0) + 1
  }

  return patch
}
