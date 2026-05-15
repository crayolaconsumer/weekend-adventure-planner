/**
 * Helpers used by UnifiedProfile and its child tabs.
 */

/**
 * Compute the "Level N Explorer" rank from SERVER stats. Used by both
 * the header pill and the Journey tab so they agree.
 *
 * Previously the level was computed from localStorage-only counters
 * (timesWentOut, boredomBusts, adventuresCreated). On someone else's
 * profile, that math used YOUR local data — your profile showed your
 * level on every device, their profile showed your level on your
 * device and their level on theirs. Completely broken cross-user.
 *
 * Activity = placesVisited + contributions + helpfulVotes/2.
 * Same square-progression curve as before so existing level art
 * (and the badge thresholds at 1/10/50/100) still align.
 */
export interface ServerProfileStats {
  placesVisited?: number
  contributions?: number
  helpfulVotes?: number
  [key: string]: unknown
}

export interface LevelInfo {
  level: number
  totalActivity: number
  currentLevelFloor: number
  nextLevelRequirement: number
  levelProgress: number
}

export function computeLevel(stats: ServerProfileStats | null | undefined): LevelInfo {
  const visited = Number(stats?.placesVisited) || 0
  const contributions = Number(stats?.contributions) || 0
  const helpful = Number(stats?.helpfulVotes) || 0
  const totalActivity = visited + contributions + Math.floor(helpful / 2)
  const level = Math.floor(Math.sqrt(totalActivity)) + 1
  const currentLevelFloor = Math.pow(level - 1, 2)
  const nextLevelRequirement = Math.pow(level, 2)
  const denominator = Math.max(nextLevelRequirement - currentLevelFloor, 1)
  const levelProgress = ((totalActivity - currentLevelFloor) / denominator) * 100
  return { level, totalActivity, currentLevelFloor, nextLevelRequirement, levelProgress }
}

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
