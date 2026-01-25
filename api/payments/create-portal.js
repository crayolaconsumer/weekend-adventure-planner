/**
 * POST /api/payments/create-portal
 *
 * Creates a Stripe Customer Portal session for managing subscriptions.
 * Allows users to update payment methods, cancel, or change plans.
 *
 * If the user doesn't have a stripe_customer_id but has an email,
 * we'll try to find or create a customer for them.
 */

import Stripe from 'stripe'
import { getUserFromRequest } from '../lib/auth.js'
import { queryOne } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting (stricter for payment operations)
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'payments:portal')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    // Require authentication
    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    let stripeCustomerId = user.stripe_customer_id

    // If user doesn't have a Stripe customer ID, try to find/create one
    if (!stripeCustomerId) {
      // First, try to find existing customer by email
      if (user.email) {
        const existingCustomers = await stripe.customers.list({
          email: user.email,
          limit: 1
        })

        if (existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id

          // Save it to the database for future use
          try {
            await queryOne(
              'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
              [stripeCustomerId, user.id]
            )
          } catch (dbError) {
            console.warn('Failed to save stripe_customer_id:', dbError)
          }
        }
      }

      // Still no customer? User has never been a subscriber
      if (!stripeCustomerId) {
        return res.status(400).json({
          error: 'No subscription found',
          message: 'You don\'t have an active subscription. Subscribe to ROAM+ to manage billing.',
          code: 'NO_SUBSCRIPTION'
        })
      }
    }

    // Verify the customer has at least one subscription (active or past)
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      limit: 1,
      status: 'all' // Include canceled subscriptions so users can resubscribe
    })

    if (subscriptions.data.length === 0) {
      return res.status(400).json({
        error: 'No subscription found',
        message: 'No subscription history found. Subscribe to ROAM+ first.',
        code: 'NO_SUBSCRIPTION_HISTORY'
      })
    }

    // Determine return URL
    const origin = req.headers.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://go-roam.com'
    const returnUrl = `${origin}/profile`

    // Create Customer Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl
    })

    return res.status(200).json({
      url: session.url
    })

  } catch (error) {
    console.error('Stripe portal error:', error)

    // Handle specific Stripe errors
    if (error.code === 'resource_missing') {
      return res.status(400).json({
        error: 'Customer not found',
        message: 'Your billing account could not be found. Please contact support.',
        code: 'CUSTOMER_NOT_FOUND'
      })
    }

    return res.status(500).json({
      error: 'Failed to create portal session',
      message: 'Something went wrong. Please try again or contact support.'
    })
  }
}
