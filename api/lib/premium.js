/**
 * Server-side premium-state helpers, mirroring the logic in
 * src/hooks/useSubscription.js so the API and the client agree on
 * who counts as premium.
 *
 * A user is premium iff:
 *   - users.tier === 'premium'
 *   - subscription_expires_at is null (lifetime / comped) OR > now()
 *
 * The DB rows we get back from queries vary in shape (snake_case from
 * raw SQL, camelCase from object literals), so the helpers accept both.
 */

export function isPremiumRow(row) {
  if (!row) return false
  const tier = row.tier ?? null
  if (tier !== 'premium') return false
  const expires =
    row.subscription_expires_at ??
    row.subscriptionExpiresAt ??
    null
  if (!expires) return true
  const t = new Date(expires).getTime()
  if (Number.isNaN(t)) return true
  return t > Date.now()
}

/**
 * SQL fragment for selecting a boolean-shaped is_premium column from
 * a users-table alias. Use like:
 *   SELECT u.id, ${IS_PREMIUM_SQL('u')} AS is_premium FROM users u ...
 */
export function isPremiumSql(alias = 'u') {
  return `(CASE WHEN ${alias}.tier = 'premium'
                AND (${alias}.subscription_expires_at IS NULL
                     OR ${alias}.subscription_expires_at > NOW())
           THEN 1 ELSE 0 END)`
}
