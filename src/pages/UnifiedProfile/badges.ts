/**
 * Badge definitions.
 *
 * Server is the single source of truth — all badges are awarded by
 * api/users/badges.js#evaluateBadges from real events (visit POST,
 * contribution POST, vote, follow, save, plan create, streak update).
 *
 * The client used to maintain a parallel BADGES list that mirrored
 * some of these with different IDs and thresholds (first_adventure
 * for first_visit, explorer_5/25/100 for visits_10/50/100), computing
 * "earned" from localStorage which leaked between users on shared
 * devices and reset on new devices. Removed. ALL_BADGES below is now
 * just the locked-tier display catalogue, keyed by the same IDs the
 * server uses, so any earned badge from /api/users/badges renders
 * with its full metadata.
 */

export interface ServerBadgeConfig {
  name: string
  description: string
}

// AchievementBadge renders the SVG illustration by badge ID — keying
// here on the same ID gives access to name + description for display
// labels and accessible-text. (No `icon` field: the SVG component is
// the icon, no emoji fallbacks anywhere.)
export const SERVER_BADGE_CONFIG: Record<string, ServerBadgeConfig> = {
  // Visit milestones (awarded on visited_places insert)
  first_visit: { name: 'First Steps', description: 'Visited your first place' },
  visits_10: { name: 'Adventurer', description: 'Visited 10 places' },
  visits_50: { name: 'Seasoned Traveler', description: 'Visited 50 places' },
  visits_100: { name: 'World Wanderer', description: 'Visited 100 places' },

  // Contribution milestones (awarded on approved contribution count)
  first_contribution: { name: 'Sharing the Way', description: 'Made your first contribution' },
  contributor_10: { name: 'Local Expert', description: 'Made 10 contributions' },
  contributor_50: { name: 'Community Pillar', description: 'Made 50 contributions' },

  // Helpful votes received (awarded on vote)
  helpful_10: { name: 'Helpful', description: 'Tips received 10 upvotes' },
  helpful_50: { name: 'Indispensable', description: 'Tips received 50 upvotes' },

  // Social (awarded on follow)
  followers_10: { name: 'Rising Star', description: 'Gained 10 followers' },
  followers_100: { name: 'Influencer', description: 'Gained 100 followers' },

  // Streak (awarded on stats update — both current and best counted)
  streak_3: { name: 'Getting Into It', description: '3 day streak' },
  streak_7: { name: 'Week Warrior', description: '7 day streak' },
  streak_30: { name: 'Unstoppable', description: '30 day streak' },

  // Activity flag (awarded once threshold is crossed)
  just_go: { name: 'Spontaneous', description: 'Used Just Go 10 times' },
  curator: { name: 'Curator', description: 'Saved 20 places to your wishlist' },
  planner: { name: 'Planner', description: 'Created 5 plans' },
}

/**
 * Ordered list of all known badge IDs, used to render the locked
 * tier in display order. Mirrors the awarding order (visit → contrib
 * → helpful → social → streak → activity flag).
 */
export const ALL_BADGE_IDS: string[] = [
  'first_visit', 'visits_10', 'visits_50', 'visits_100',
  'first_contribution', 'contributor_10', 'contributor_50',
  'helpful_10', 'helpful_50',
  'followers_10', 'followers_100',
  'streak_3', 'streak_7', 'streak_30',
  'just_go', 'curator', 'planner',
]
