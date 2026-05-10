/* global process */
/**
 * POST /api/auth/apple-notifications
 *
 * Sign in with Apple — server-to-server notifications endpoint.
 * Required by App Store Review Guideline 4.8: if the app offers Sign
 * in with Apple, the server must accept and process Apple's lifecycle
 * notifications (account deletion, consent revocation, email-relay
 * changes). Without this endpoint, Apple's audit fails review.
 *
 * Apple posts a signed JWT in the request body:
 *   Content-Type: application/x-www-form-urlencoded
 *   payload=<JWT>
 *
 * The JWT claims include:
 *   iss: "https://appleid.apple.com"
 *   aud: <our Service ID>           (e.g. com.goroam.app.signin)
 *   sub: <user's apple_id>
 *   events: { type, sub, email?, is_private_email?, event_time }
 *     - account-delete     : user deleted their Apple ID entirely
 *     - consent-revoked    : user revoked our app's Apple access
 *     - email-disabled     : user disabled email forwarding (private relay)
 *     - email-enabled      : user re-enabled email forwarding
 *
 * `events` arrives as a JSON-encoded string; we parse it.
 *
 * Responsibilities:
 *   - account-delete / consent-revoked → hard-delete the local user row
 *     so we stop using their data (Apple has already cut off access).
 *   - email-disabled / email-enabled → log only. We rely on apple_id,
 *     not the email, so no further action needed.
 *
 * Returns 200 even when the user can't be found (idempotent — Apple may
 * retry). Never returns 4xx/5xx unless the JWT itself is invalid, since
 * Apple will retry indefinitely on errors.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose'
import { queryOne, transaction } from '../lib/db.js'

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const APPLE_SERVICES_ID = process.env.APPLE_SIGNIN_SERVICES_ID
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.goroam.app'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!APPLE_SERVICES_ID) {
    console.error('apple-notifications: APPLE_SIGNIN_SERVICES_ID not configured')
    return res.status(500).json({ error: 'Server misconfigured' })
  }

  // Apple sends form-urlencoded by default. Vercel parses both
  // application/json and application/x-www-form-urlencoded into req.body.
  const payloadJwt = req.body?.payload
  if (!payloadJwt || typeof payloadJwt !== 'string') {
    return res.status(400).json({ error: 'Missing payload' })
  }

  // Verify JWT — signature against Apple's JWKS, issuer, audience, expiry.
  let claims
  try {
    const verified = await jwtVerify(payloadJwt, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: [APPLE_SERVICES_ID, APPLE_BUNDLE_ID],
    })
    claims = verified.payload
  } catch (err) {
    console.error('apple-notifications: JWT verification failed:', err?.message)
    return res.status(401).json({ error: 'Invalid token' })
  }

  // `events` arrives as a JSON-encoded string per Apple's spec.
  let event
  try {
    event = typeof claims.events === 'string' ? JSON.parse(claims.events) : claims.events
  } catch {
    console.error('apple-notifications: events claim not parseable JSON')
    return res.status(400).json({ error: 'Malformed events claim' })
  }

  if (!event || typeof event !== 'object') {
    return res.status(400).json({ error: 'Missing event' })
  }

  const eventType = event.type
  const appleId = event.sub
  if (!eventType || !appleId) {
    return res.status(400).json({ error: 'Event missing type or sub' })
  }

  // Look up the local user by apple_id. May be null if they already
  // deleted in-app (Apple still sends notifications post-deletion).
  const user = await queryOne(
    'SELECT id, username, subscription_id, stripe_customer_id FROM users WHERE apple_id = ?',
    [appleId]
  )

  if (eventType === 'account-delete' || eventType === 'consent-revoked') {
    if (!user) {
      console.log(`apple-notifications: ${eventType} for unknown apple_id (already gone) — ack`)
      return res.status(200).json({ ok: true })
    }

    // Cancel Stripe subscription if any — best-effort.
    if (user.subscription_id) {
      try {
        const { default: Stripe } = await import('stripe')
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
        await stripe.subscriptions.cancel(user.subscription_id).catch(() => {})
      } catch (err) {
        console.warn('apple-notifications: Stripe cancel failed (continuing):', err?.message)
      }
    }

    try {
      await transaction(async (conn) => {
        await conn.query('DELETE FROM swiped_places WHERE user_id = ?', [user.id])
        await conn.query('DELETE FROM content_reports WHERE reporter_id = ? OR reported_user_id = ?', [user.id, user.id]).catch(() => {})
        await conn.query('DELETE FROM users WHERE id = ?', [user.id])
      })
      console.log(`apple-notifications: deleted user ${user.id} (${user.username}) on ${eventType}`)
    } catch (err) {
      console.error('apple-notifications: deletion failed:', err)
      // Tell Apple to retry — better to over-delete than to lose the signal.
      return res.status(500).json({ error: 'Deletion failed' })
    }

    return res.status(200).json({ ok: true })
  }

  // email-disabled / email-enabled — informational only. We sign in by
  // apple_id, never the email, so there's nothing functional to update.
  if (eventType === 'email-disabled' || eventType === 'email-enabled') {
    console.log(`apple-notifications: ${eventType} for user_id=${user?.id ?? 'unknown'}`)
    return res.status(200).json({ ok: true })
  }

  // Unknown event type — log and ack. New event types may be introduced
  // by Apple; failing here would cause infinite retries.
  console.warn(`apple-notifications: unknown event type "${eventType}" — acked anyway`)
  return res.status(200).json({ ok: true })
}
