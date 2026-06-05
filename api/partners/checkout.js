/**
 * POST /api/partners/checkout
 *
 * Creates a one-time Stripe Checkout session (mode: 'payment') to pay the flat
 * fee for a promoted event. The price is recomputed server-side from the
 * stored promotion parameters — the client never supplies a price.
 *
 * On success, Stripe redirects back and the webhook
 * (api/payments/webhook.js -> handleCheckoutCompleted) marks the event
 * paid + active. Reuses the existing STRIPE_SECRET_KEY (no new secrets).
 */

import Stripe from 'stripe'
import { requireAuth } from '../lib/auth.js'
import { queryOne, query } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { isFeatureEnabled } from '../lib/flags.js'
import { validateId } from '../lib/validation.js'
import { quotePromotion } from '../lib/promoPricing.js'

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('FATAL: STRIPE_SECRET_KEY not configured (partners/checkout)')
}

// Lazy init — constructing Stripe with an undefined key throws at module load,
// which would surface as an opaque platform 500 (e.g. on a preview deploy that
// lacks the key). Build it on first use, after the key-present check below.
let stripeClient = null
function getStripe() {
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY)
  return stripeClient
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'partners:checkout')
  if (rateLimitError) return res.status(rateLimitError.status).json(rateLimitError)

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Payment system not configured' })
  }
  if (!(await isFeatureEnabled('promotedEvents'))) {
    return res.status(503).json({ error: 'Partner platform is temporarily unavailable' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const idCheck = validateId(req.body?.promoted_event_id)
    if (!idCheck.valid) return res.status(400).json({ error: 'Invalid promoted_event_id' })

    // Ownership + state check (joined so a partner can only pay for own events).
    const event = await queryOne(
      `SELECT pe.*, pa.user_id AS owner_user_id, pa.status AS partner_status
       FROM promoted_events pe
       JOIN partner_accounts pa ON pe.partner_id = pa.id
       WHERE pe.id = ? AND pa.user_id = ?`,
      [idCheck.id, user.id]
    )
    if (!event) return res.status(404).json({ error: 'Event not found' })
    if (event.partner_status !== 'active') {
      return res.status(403).json({ error: 'This partner account is suspended', code: 'PARTNER_SUSPENDED' })
    }
    if (event.payment_status === 'paid') {
      return res.status(409).json({ error: 'This event is already paid for' })
    }
    if (event.status === 'cancelled') {
      return res.status(409).json({ error: 'This event has been cancelled' })
    }
    // An "online" event with no ticket link would publish a dead "Get tickets"
    // CTA — block payment until there's a link (or switch to door/free).
    if (event.ticket_type === 'online' && !event.info_url) {
      return res.status(400).json({ error: 'Add a ticket link before paying, or set admission to “Pay on the door” / “Free entry”.', code: 'TICKET_LINK_REQUIRED' })
    }

    // Recompute the price authoritatively — ignore any stored/sent value.
    // Includes the push-boost add-on if the organiser opted into it.
    const quote = quotePromotion({
      radiusKm: event.promo_radius_km,
      startOn: event.promo_starts_on,
      endOn: event.promo_ends_on,
      pushBoost: !!event.push_boost
    })
    if (!quote.valid) return res.status(400).json({ error: quote.message })

    // Ensure the user has a Stripe customer (shared with subscriptions).
    let stripeCustomerId = user.stripe_customer_id
    if (!stripeCustomerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        metadata: { user_id: String(user.id), username: user.username || '' }
      })
      stripeCustomerId = customer.id
      await query('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [stripeCustomerId, user.id])
    }

    const origin = req.headers.origin || process.env.APP_URL || 'https://www.go-roam.uk'
    const session = await getStripe().checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: quote.currency.toLowerCase(),
          unit_amount: quote.pricePence,
          product_data: {
            name: `ROAM Featured event: ${event.title}`.slice(0, 250),
            description: `${quote.days} day(s), ${quote.radiusKm}km radius`
          }
        }
      }],
      success_url: `${origin}/partners/events/${event.id}?paid=success`,
      cancel_url: `${origin}/partners/events/${event.id}?paid=cancelled`,
      metadata: {
        type: 'promoted_event',
        promoted_event_id: String(event.id),
        partner_id: String(event.partner_id),
        user_id: String(user.id)
      }
    })

    // Move the event into pending_payment and remember the session + price.
    await query(
      `UPDATE promoted_events
       SET status = 'pending_payment',
           stripe_checkout_session_id = ?,
           price_paid_pence = ?
       WHERE id = ?`,
      [session.id, quote.pricePence, event.id]
    )

    return res.status(200).json({ url: session.url, sessionId: session.id, quote })
  } catch (error) {
    console.error('Partner checkout error:', error)
    if (error?.type === 'StripeCardError') {
      return res.status(400).json({ error: error.message })
    }
    return res.status(500).json({ error: 'Failed to create checkout session' })
  }
}

export default withCors(handler)
