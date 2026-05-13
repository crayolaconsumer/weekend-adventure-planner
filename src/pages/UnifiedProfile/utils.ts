/**
 * Helpers used by UnifiedProfile and its child tabs.
 */

export interface ProfileStats {
  totalSwipes: number
  timesWentOut: number
  boredomBusts: number
  bestStreak: number
  lastActivityDate: string | null
  currentStreak: number
  wishlistCount: number
  adventuresCreated: number
  // Tolerate arbitrary keys read from localStorage by older versions.
  [key: string]: unknown
}

/**
 * Read the auth token from local/session storage. Matches the storage
 * keys used everywhere else in the app.
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

/**
 * Hydrate a stats object from localStorage with sane defaults +
 * streak-reset logic that mirrors Discover.jsx (so the two surfaces
 * agree on whether the streak is broken).
 */
export function loadStatsFromStorage(): ProfileStats {
  const savedStats = JSON.parse(localStorage.getItem('roam_stats') || '{}') as Record<string, unknown>
  const wishlist = JSON.parse(localStorage.getItem('roam_wishlist') || '[]') as unknown[]
  const adventures = JSON.parse(localStorage.getItem('roam_adventures') || '[]') as unknown[]

  // Use lastStreakDate (not lastActivityDate) - this matches Discover.jsx logic
  const lastStreakDate = savedStats.lastStreakDate as string | undefined
  let currentStreak = (savedStats.currentStreak as number) || 0

  if (lastStreakDate) {
    // Check if streak should be reset (more than 1 day since last streak update)
    const lastDate = new Date(lastStreakDate)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    // If lastStreakDate is neither today nor yesterday, streak is broken
    const lastDateStr = lastDate.toDateString()
    const todayStr = today.toDateString()
    const yesterdayStr = yesterday.toDateString()

    if (lastDateStr !== todayStr && lastDateStr !== yesterdayStr) {
      currentStreak = 0
    }
  }

  return {
    totalSwipes: 0,
    timesWentOut: 0,
    boredomBusts: 0,
    bestStreak: 0,
    lastActivityDate: null,
    ...savedStats,
    currentStreak,
    wishlistCount: wishlist.length,
    adventuresCreated: adventures.length,
  } as ProfileStats
}
