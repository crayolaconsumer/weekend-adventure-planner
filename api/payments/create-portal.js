/**
 * POST /api/payments/create-portal
 *
 * Creates a Stripe Customer Portal session for managing subscriptions.
 * Allows users to update payment methods, cancel, or change plans.
 */

import Stripe from 'stripe'
import { getUserFromRequest } from '../lib/auth.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Require authentication
    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    // User must have a Stripe customer ID
    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: 'No subscription found' })
    }

    // Determine return URL
    const origin = req.headers.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://go-roam.com'
    const returnUrl = `${origin}/profile`

    // Create Customer Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: returnUrl
    })

    return res.status(200).json({
      url: session.url
    })

  } catch (error) {
    console.error('Stripe portal error:', error)
    return res.status(500).json({ error: 'Failed to create portal session' })
  }
}
