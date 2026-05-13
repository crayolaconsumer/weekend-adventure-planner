/**
 * Server-side mirror of src/utils/displayName.ts
 *
 * Used by server-rendered surfaces (OG image, push notifications,
 * notification bodies, emails) to resolve a friendly name in the same
 * way the frontend does — no email leakage in machine-rendered text.
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
