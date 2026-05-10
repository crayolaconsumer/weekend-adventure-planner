/**
 * Server-side mirror of src/utils/displayName.js
 *
 * Used by server-rendered surfaces (OG image, push notifications,
 * notification bodies, emails) to resolve a friendly name in the same
 * way the frontend does — no email leakage in machine-rendered text.
 */

export function formatDisplayName(user) {
  if (!user || typeof user !== 'object') return 'Someone'
  const display = user.displayName ?? user.display_name ?? null
  const username = user.username ?? null

  const isClean = (s) => typeof s === 'string' && s.trim().length > 0 && !s.includes('@')
  if (isClean(display)) return display.trim()
  if (isClean(username)) return username.trim()

  const stripDomain = (s) => (typeof s === 'string' ? s.split('@')[0].trim() : '')
  return stripDomain(display) || stripDomain(username) || 'Someone'
}
