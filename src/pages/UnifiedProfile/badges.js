/**
 * Badge definitions for the UnifiedProfile Journey tab.
 *
 * Two sources:
 *   - BADGES: client-side activity badges (computed from localStorage stats).
 *   - SERVER_BADGE_CONFIG: display config for server-awarded badges (lookup
 *     from `badgeId` returned by /api/users/badges).
 *
 * Keep the BADGES requirement predicates pure — they read directly from
 * the stats object produced by loadStatsFromStorage().
 */

export const BADGES = [
  { id: 'first_adventure', name: 'First Steps', icon: '🌱', description: 'Completed your first adventure', requirement: (s) => s.timesWentOut >= 1 },
  { id: 'explorer_5', name: 'Explorer', icon: '🧭', description: 'Visited 5 places', requirement: (s) => s.timesWentOut >= 5 },
  { id: 'explorer_25', name: 'Pathfinder', icon: '🗺️', description: 'Visited 25 places', requirement: (s) => s.timesWentOut >= 25 },
  { id: 'explorer_100', name: 'Wanderer', icon: '🌍', description: 'Visited 100 places', requirement: (s) => s.timesWentOut >= 100 },
  { id: 'streak_3', name: 'Getting Into It', icon: '🔥', description: '3 day streak', requirement: (s) => s.bestStreak >= 3 },
  { id: 'streak_7', name: 'Week Warrior', icon: '⚡', description: '7 day streak', requirement: (s) => s.bestStreak >= 7 },
  { id: 'streak_30', name: 'Unstoppable', icon: '💪', description: '30 day streak', requirement: (s) => s.bestStreak >= 30 },
  { id: 'just_go', name: 'Spontaneous', icon: '🎯', description: 'Used Just Go 10 times', requirement: (s) => (s.justGoUses || 0) + (s.boredomBusts || 0) >= 10 },
  { id: 'curator', name: 'Curator', icon: '📚', description: 'Saved 20 places to wishlist', requirement: (s) => s.wishlistCount >= 20 },
  { id: 'planner', name: 'Planner', icon: '📋', description: 'Created 5 adventures', requirement: (s) => s.adventuresCreated >= 5 },
]

// Server badge display config (maps badge_id to icon/name).
export const SERVER_BADGE_CONFIG = {
  first_contribution: { icon: '✍️', name: 'First Steps', description: 'Made your first contribution' },
  contributor_10: { icon: '📝', name: 'Local Expert', description: 'Made 10 contributions' },
  contributor_50: { icon: '🏆', name: 'Community Pillar', description: 'Made 50 contributions' },
  first_visit: { icon: '🧭', name: 'Explorer', description: 'Visited your first place' },
  visits_10: { icon: '🗺️', name: 'Adventurer', description: 'Visited 10 places' },
  visits_50: { icon: '🌍', name: 'Seasoned Traveler', description: 'Visited 50 places' },
  visits_100: { icon: '🌟', name: 'World Wanderer', description: 'Visited 100 places' },
  followers_10: { icon: '⭐', name: 'Rising Star', description: 'Gained 10 followers' },
  followers_100: { icon: '👑', name: 'Influencer', description: 'Gained 100 followers' },
}
