/**
 * Resolve a friendly display name for a user record from the API.
 *
 * Why this exists: some users have `display_name` set to their email
 * (e.g. legacy "alexdhilsdon@hotmail.co.uk" rows from before we validated
 * input). Showing the full email in feeds is ugly and breaks layouts.
 *
 * Resolution order:
 *   1. display_name if it's a real name (no '@')
 *   2. username if it's a real handle (no '@')
 *   3. first segment of either before '@' (graceful email truncation)
 *   4. 'Someone' as a final fallback
 *
 * Accepts either snake_case or camelCase shapes (the API exposes
 * displayName, but raw DB rows have display_name).
 */

export interface UserLike {
  displayName?: string | null
  display_name?: string | null
  username?: string | null
}

export function formatDisplayName(user: UserLike | null | undefined | unknown): string {
  if (!user || typeof user !== 'object') return 'Someone'
  const u = user as UserLike
  const display = u.displayName ?? u.display_name ?? null
  const username = u.username ?? null

  const isClean = (s: unknown): s is string =>
    typeof s === 'string' && s.trim().length > 0 && !s.includes('@')
  if (isClean(display)) return display.trim()
  if (isClean(username)) return username.trim()

  const stripDomain = (s: unknown): string =>
    typeof s === 'string' ? s.split('@')[0].trim() : ''
  return stripDomain(display) || stripDomain(username) || 'Someone'
}

/**
 * True if a user's display name needs setting (missing OR email-shaped).
 * Used to surface a one-shot "set a display name" prompt to legacy users.
 */
export function needsDisplayName(user: UserLike | null | undefined | unknown): boolean {
  if (!user || typeof user !== 'object') return false
  const u = user as UserLike
  const display = u.displayName ?? u.display_name ?? null
  if (!display) return true
  if (typeof display !== 'string') return true
  return display.includes('@') || display.trim().length === 0
}
