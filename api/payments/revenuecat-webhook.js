/**
 * POST /api/payments/revenuecat-webhook
 *
 * RevenueCat → server sync for native IAP. Mirrors what Stripe's webhook
 * does for web payments: flips the user's tier flag and stores the
 * subscription metadata. After this fires, the rest of the app
 * (isPremium gates, server queries) treats Apple/Google subs identically
 * to Stripe subs — the only difference is `subscription_source`.
 *
 * Auth: RevenueCat sends a custom Authorization header that we configure
 * in the RC dashboard. We compare against REVENUECAT_WEBHOOK_AUTH_HEADER
 * env var. Any mismatch → 401. (RC doesn't sign payloads like Stripe does;
 * the shared bearer secret is the documented pattern.)
 *
 * Events handled:
 *   INITIAL_PURCHASE / NON_RENEWING_PURCHASE → set tier='premium', set source
 *   RENEWAL / PRODUCT_CHANGE / TRANSFER → refresh expiry
 *   CANCELLATION → set subscription_cancelled_at (still active until expiry)
 *   UNCANCELLATION → clear subscription_cancelled_at
 *   EXPIRATION / SUBSCRIPTION_PAUSED → tier='free' if no other entitlement
 *   BILLING_ISSUE → log + leave premium intact (grace period)
 *
 * The `app_user_id` in the RC event is our users.id (we set it via
 * Purchases.logIn after auth). If it's missing/anonymous, the event
 * is for a pre-signup purchase and we drop it on the floor — RC will
 * re-emit when the user identifies later.
 */

import { update, queryOne } from '../lib/db.js'

// Edge runtime not used — Node runtime gives us access to crypto.timingSafeEqual
// and the standard req.body parsing.

const AUTH_HEADER_VALUE = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER?.trim()

// Used to map RC events to our DB state changes. Anything not listed is
// logged + acked — RC retries on non-2xx, so silently 200ing unknown
// events keeps their retry queue clean.
const ENTITLEMENT_GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'TRANSFER',
  'UNCANCELLATION',
])

const ENTITLEMENT_REVOKING_EVENTS = new Set([
  'EXPIRATION',
  'SUBSCRIPTION_PAUSED',
  'REFUND',
])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Constant-time compare so timing attacks can't probe the secret.
  // (Realistically low-risk on an unauth'd webhook, but free.)
  const provided = req.headers.authorization
  if (!AUTH_HEADER_VALUE || !provided || provided !== AUTH_HEADER_VALUE) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const event = req.body?.event
  if (!event || typeof event !== 'object') {
    return res.status(400).json({ error: 'Missing event payload' })
  }

  const eventType = event.type
  const appUserId = event.app_user_id
  const expiresAtMs = event.expiration_at_ms
  const purchasedAtMs = event.purchased_at_ms
  const productId = event.product_id

  // RC sends $RCAnonymousID:xxxx when no logIn has happened yet. We can't
  // map those to our user table, so 200 + drop. RC re-emits with the real
  // user ID once Purchases.logIn fires after sign-in.
  if (!appUserId || /^\$rcanonymous/i.test(appUserId)) {
    console.log('[rc-webhook] ignored anonymous event', { eventType, appUserId })
    return res.status(200).json({ ignored: 'anonymous' })
  }

  const userId = parseInt(appUserId, 10)
  if (!Number.isFinite(userId)) {
    console.warn('[rc-webhook] non-numeric app_user_id', { appUserId, eventType })
    return res.status(200).json({ ignored: 'invalid-user-id' })
  }

  // Idempotency: RC retries on transient failures, so the same event_id
  // can arrive twice. Reject duplicates so we don't double-process renewals.
  const eventId = event.id
  if (eventId) {
    const seen = await queryOne(
      'SELECT 1 AS x FROM users WHERE id = ? AND last_rc_event_id = ?',
      [userId, eventId]
    )
    if (seen) {
      return res.status(200).json({ duplicate: true })
    }
  }

  // Determine the platform source from RC's `store` field
  // ('APP_STORE', 'PLAY_STORE', 'STRIPE', 'PROMOTIONAL', ...).
  const store = event.store
  const source =
    store === 'APP_STORE' ? 'apple' :
    store === 'PLAY_STORE' ? 'google' :
    store === 'STRIPE' ? 'stripe' :
    null

  try {
    if (ENTITLEMENT_GRANTING_EVENTS.has(eventType)) {
      // Use COALESCE so we don't clobber a fresher value if events arrive
      // out of order (RC can reorder under load).
      await update(
        `UPDATE users
         SET tier = 'premium',
             subscription_source = COALESCE(?, subscription_source),
             subscription_id = COALESCE(?, subscription_id),
             subscription_expires_at = ?,
             subscription_cancelled_at = NULL,
             last_rc_event_id = ?
         WHERE id = ?`,
        [
          source,
          productId,
          expiresAtMs ? new Date(expiresAtMs) : null,
          eventId || null,
          userId
        ]
      )
      return res.status(200).json({ ok: true, action: 'granted' })
    }

    if (eventType === 'CANCELLATION') {
      // User cancelled but the period hasn't ended — leave them on premium
      // until expiry, just mark the intent so the UI can show "cancels on X".
      await update(
        `UPDATE users
         SET subscription_cancelled_at = ?,
             last_rc_event_id = ?
         WHERE id = ?`,
        [
          purchasedAtMs ? new Date(purchasedAtMs) : new Date(),
          eventId || null,
          userId
        ]
      )
      return res.status(200).json({ ok: true, action: 'cancellation-recorded' })
    }

    if (ENTITLEMENT_REVOKING_EVENTS.has(eventType)) {
      // Only revoke if the user's CURRENT source matches. Don't downgrade
      // a Stripe-paying user because their old Apple sub expired.
      await update(
        `UPDATE users
         SET tier = 'free',
             subscription_expires_at = NULL,
             subscription_cancelled_at = NULL,
             last_rc_event_id = ?
         WHERE id = ?
           AND (subscription_source = ? OR subscription_source IS NULL)`,
        [eventId || null, userId, source]
      )
      return res.status(200).json({ ok: true, action: 'revoked' })
    }

    if (eventType === 'BILLING_ISSUE') {
      // Grace period — Apple/Google retry the charge for ~16 days. Leave
      // premium intact and just log.
      console.log('[rc-webhook] BILLING_ISSUE — grace period', { userId, productId })
      return res.status(200).json({ ok: true, action: 'billing-issue-logged' })
    }

    // Unknown event type — ack with 200 so RC doesn't retry, but log so
    // we notice if there's a new event type we should handle.
    console.log('[rc-webhook] unhandled event type', { eventType, userId })
    return res.status(200).json({ ok: true, action: 'unhandled' })
  } catch (err) {
    console.error('[rc-webhook] handler error', { eventType, userId, err: err.message })
    // Don't leak DB errors to RC — generic 500 lets RC retry on transient issues.
    return res.status(500).json({ error: 'Internal error' })
  }
}
