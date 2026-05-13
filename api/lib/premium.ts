/**
 * Server-side premium-state helpers, mirroring the logic in
 * src/hooks/useSubscription.js so the API and the client agree on
 * who counts as premium.
 *
 * A user is premium iff:
 *   - users.tier === 'premium'
 *   - subscription_expires_at is null (lifetime / comped) OR > now()
 */

export interface PremiumRow {
  tier?: string | null
  subscription_expires_at?: string | Date | null
  subscriptionExpiresAt?: string | Date | null
  [key: string]: unknown
}

export function isPremiumRow(row: PremiumRow | null | undefined | unknown): boolean {
  if (!row || typeof row !== 'object') return false
  const r = row as PremiumRow
  const tier = r.tier ?? null
  if (tier !== 'premium') return false
  const expires = r.subscription_expires_at ?? r.subscriptionExpiresAt ?? null
  if (!expires) return true
  const t = new Date(expires as string | Date).getTime()
  if (Number.isNaN(t)) return true
  return t > Date.now()
}

/**
 * SQL fragment for selecting a boolean-shaped is_premium column from
 * a users-table alias. Use like:
 *   SELECT u.id, ${IS_PREMIUM_SQL('u')} AS is_premium FROM users u ...
 */
export function isPremiumSql(alias: string = 'u'): string {
  return `(CASE WHEN ${alias}.tier = 'premium'
                AND (${alias}.subscription_expires_at IS NULL
                     OR ${alias}.subscription_expires_at > NOW())
           THEN 1 ELSE 0 END)`
}
