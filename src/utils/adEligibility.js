/**
 * Who may be shown or requested an ad. Paid users must never get one, even
 * when /api/auth is down: then user is null and isPremium would read false.
 *
 * So ads are off when:
 *   - the user is premium, or
 *   - the user is unknown but a sign-in token is stored (auth check failed
 *     on network / 5xx; the token was kept), or
 *   - the user is unknown and was premium the last time the tier was known
 *     (roam_last_premium, cleared only by an explicit sign out).
 */
const LAST_PREMIUM_KEY = 'roam_last_premium'
const TOKEN_KEYS = ['roam_auth_token', 'roam_auth_token_session']

export function isPremiumUser(user) {
  if (!user) return false
  if (user.tier === 'premium') {
    // Check if subscription hasn't expired
    if (user.subscription_expires_at) {
      return new Date(user.subscription_expires_at) > new Date()
    }
    return true
  }
  return false
}

function read(storage, key) {
  try { return storage.getItem(key) } catch { return null }
}

/** Call whenever the tier is known (a user object arrived). */
export function rememberPremium(user) {
  try { localStorage.setItem(LAST_PREMIUM_KEY, isPremiumUser(user) ? '1' : '0') } catch { /* private mode */ }
}

/** Call on explicit sign out / account deletion. */
export function forgetPremium() {
  try { localStorage.removeItem(LAST_PREMIUM_KEY) } catch { /* private mode */ }
}

export function isAdFree(user) {
  if (user) return isPremiumUser(user)
  if (TOKEN_KEYS.some(k => read(localStorage, k) || read(sessionStorage, k))) return true
  return read(localStorage, LAST_PREMIUM_KEY) === '1'
}
