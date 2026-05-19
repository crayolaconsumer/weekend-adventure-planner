/**
 * POST /api/payments/create-checkout
 *
 * Creates a Stripe Checkout session for premium subscriptions.
 * Returns a checkout URL to redirect the user to.
 *
 * Features:
 * - Environment validation at module load
 * - Rate limiting: 1 request per user per 60 seconds
 * - Automatic tax calculation (UK VAT)
 */

import Stripe from 'stripe'
import { getUserFromRequest } from '../lib/auth.js'
import { queryOne } from '../lib/db.js'
import { withCors } from '../lib/cors.js'

// Validate required environment variables at module load
const REQUIRED_ENV_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_PREMIUM_MONTHLY',
  'STRIPE_PRICE_PREMIUM_ANNUAL'
]

const missingEnvVars = REQUIRED_ENV_VARS.filter(key => !process.env[key])
if (missingEnvVars.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Price IDs from Stripe Dashboard (configure these in Stripe)
const PRICE_IDS = {
  premium_monthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
  premium_annual: process.env.STRIPE_PRICE_PREMIUM_ANNUAL
}

// Simple in-memory rate limiter (resets on cold start)
// Maps user_id -> timestamp of last checkout request
const checkoutRateLimit = new Map()
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Fail fast if env vars not configured
  if (missingEnvVars.length > 0) {
    return res.status(500).json({
      error: 'Payment system not configured',
      missing: missingEnvVars
    })
  }

  try {
    // Require authentication
    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    // Rate limiting: 1 checkout per user per minute
    const now = Date.now()
    const lastRequest = checkoutRateLimit.get(user.id)
    if (lastRequest && (now - lastRequest) < RATE_LIMIT_WINDOW_MS) {
      const waitSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - lastRequest)) / 1000)
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: waitSeconds
      })
    }
    checkoutRateLimit.set(user.id, now)

    const { plan = 'premium_monthly' } = req.body

    // Validate plan
    if (!['premium_monthly', 'premium_annual'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' })
    }

    const priceId = PRICE_IDS[plan]
    if (!priceId) {
      return res.status(500).json({ error: 'Price not configured' })
    }

    // Check if user already has a Stripe customer ID
    let stripeCustomerId = user.stripe_customer_id

    if (!stripeCustomerId) {
      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_id: user.id.toString(),
          username: user.username || ''
        }
      })

      stripeCustomerId = customer.id

      // Save customer ID to database
      await queryOne(
        'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
        [stripeCustomerId, user.id]
      )
    }

    // Trial eligibility: a user gets ONE 7-day trial per Stripe customer.
    // Without this guard, a user who started a trial, cancelled, then
    // came back through /pricing would get another trial — and could
    // loop that forever for free.
    //
    // Two-layer check:
    //   1. Our DB: subscription_id set (or ever was) means they used
    //      the trial slot. Fast path, no Stripe API call.
    //   2. Stripe: list any subscriptions ever attached to this
    //      customer (status='all' includes canceled, ended, etc.).
    //      Catches edge cases where the DB lost the link (webhook
    //      missed, manual deletion, etc.).
    let trialEligible = true
    if (user.subscription_id) {
      trialEligible = false
    } else {
      try {
        const prior = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: 'all',
          limit: 1
        })
        if (prior?.data?.length > 0) trialEligible = false
      } catch (err) {
        // If Stripe lookup fails, fail CLOSED — no trial. Better to be
        // mildly annoying than to leak a free week.
        console.warn('[create-checkout] trial-eligibility lookup failed, defaulting to no-trial:', err.message)
        trialEligible = false
      }
    }

    // Determine success and cancel URLs
    const origin = req.headers.origin || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.go-roam.uk'
    const successUrl = `${origin}/profile?subscription=success`
    const cancelUrl = `${origin}/pricing?subscription=cancelled`

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        // Only grant a trial when the user is genuinely eligible —
        // first time subscribing on this Stripe customer. Returning
        // customers go straight to paid.
        ...(trialEligible ? { trial_period_days: 7 } : {}),
        metadata: {
          user_id: user.id.toString(),
          plan,
          trial_granted: trialEligible ? '1' : '0'
        }
      },
      // Allow promotion codes
      allow_promotion_codes: true,
      // Collect billing address (optional, for your records)
      billing_address_collection: 'auto'
      // Note: When you become VAT registered (>£90k turnover), add:
      // automatic_tax: { enabled: true },
      // tax_id_collection: { enabled: true }
    })

    return res.status(200).json({
      url: session.url,
      sessionId: session.id
    })

  } catch (error) {
    console.error('Stripe checkout error:', error)

    if (error.type === 'StripeCardError') {
      return res.status(400).json({ error: error.message })
    }

    return res.status(500).json({ error: 'Failed to create checkout session' })
  }
}

export default withCors(handler)
