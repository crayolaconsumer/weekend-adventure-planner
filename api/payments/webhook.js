/**
 * POST /api/payments/webhook
 *
 * Stripe webhook handler for subscription lifecycle events.
 * Handles: checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted, invoice.payment_failed
 *
 * Features:
 * - Idempotency: Checks if event already processed before handling
 * - Transactions: Atomic updates across tables
 * - Signature verification: Validates Stripe signature
 */

import Stripe from 'stripe'
import { query, queryOne, insert, update, transaction } from '../lib/db.js'

// Validate required environment variables at module load
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('FATAL: STRIPE_SECRET_KEY not configured')
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.error('FATAL: STRIPE_WEBHOOK_SECRET not configured')
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

// Disable body parsing - Stripe requires raw body for signature verification
export const config = {
  api: {
    bodyParser: false
  }
}

// Helper to read raw body
async function getRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validate webhook secret is configured
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured')
    return res.status(500).json({ error: 'Webhook not configured' })
  }

  try {
    const rawBody = await getRawBody(req)
    const signature = req.headers['stripe-signature']

    // Verify webhook signature
    let event
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return res.status(400).json({ error: 'Invalid signature' })
    }

    // IDEMPOTENCY CHECK: Skip if already processed
    const existingEvent = await queryOne(
      'SELECT id, processed FROM payment_events WHERE stripe_event_id = ?',
      [event.id]
    )

    if (existingEvent?.processed) {
      console.log(`Event ${event.id} already processed, skipping`)
      return res.status(200).json({ received: true, duplicate: true })
    }

    // Log event for audit trail (if not already logged)
    if (!existingEvent) {
      await insert(
        `INSERT INTO payment_events (stripe_event_id, event_type, payload)
         VALUES (?, ?, ?)`,
        [event.id, event.type, JSON.stringify(event.data)]
      )
    }

    // Handle the event with transaction for data consistency
    await transaction(async (conn) => {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object, conn)
          break

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object, conn)
          break

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object, conn)
          break

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object, conn)
          break

        case 'invoice.paid':
          await handleInvoicePaid(event.data.object, conn)
          break

        default:
          console.log(`Unhandled event type: ${event.type}`)
      }

      // Mark event as processed WITHIN the transaction
      await conn.query(
        `UPDATE payment_events
         SET processed = TRUE, processed_at = NOW()
         WHERE stripe_event_id = ?`,
        [event.id]
      )
    })

    return res.status(200).json({ received: true })

  } catch (error) {
    console.error('Webhook error:', error)
    return res.status(500).json({ error: 'Webhook handler failed' })
  }
}

/**
 * Handle successful checkout - activate subscription
 * @param {Object} session - Stripe checkout session
 * @param {Object} conn - Database connection for transaction
 */
async function handleCheckoutCompleted(session, conn) {
  const customerId = session.customer
  const subscriptionId = session.subscription

  // Get user by Stripe customer ID
  const [users] = await conn.query(
    'SELECT id FROM users WHERE stripe_customer_id = ?',
    [customerId]
  )
  const user = users[0]

  if (!user) {
    console.error('No user found for customer:', customerId)
    return
  }

  // Get subscription details from Stripe
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const plan = subscription.metadata?.plan || 'premium_monthly'

  // Update user tier
  await conn.query(
    `UPDATE users
     SET tier = 'premium',
         subscription_id = ?,
         subscription_expires_at = FROM_UNIXTIME(?)
     WHERE id = ?`,
    [subscriptionId, subscription.current_period_end, user.id]
  )

  // Record subscription in subscriptions table
  await conn.query(
    `INSERT INTO subscriptions
     (user_id, stripe_subscription_id, stripe_customer_id, plan_id, status,
      current_period_start, current_period_end)
     VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?))
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       current_period_start = VALUES(current_period_start),
       current_period_end = VALUES(current_period_end)`,
    [
      user.id,
      subscriptionId,
      customerId,
      plan,
      subscription.status,
      subscription.current_period_start,
      subscription.current_period_end
    ]
  )

  console.log(`User ${user.id} upgraded to premium`)
}

/**
 * Handle subscription updates (renewal, plan change)
 * @param {Object} subscription - Stripe subscription object
 * @param {Object} conn - Database connection for transaction
 */
async function handleSubscriptionUpdated(subscription, conn) {
  const customerId = subscription.customer
  const subscriptionId = subscription.id

  // Get user by Stripe customer ID
  const [users] = await conn.query(
    'SELECT id FROM users WHERE stripe_customer_id = ?',
    [customerId]
  )
  const user = users[0]

  if (!user) {
    console.error('No user found for customer:', customerId)
    return
  }

  // Determine tier based on subscription status
  const tier = ['active', 'trialing'].includes(subscription.status) ? 'premium' : 'free'

  // Update user
  await conn.query(
    `UPDATE users
     SET tier = ?,
         subscription_expires_at = FROM_UNIXTIME(?),
         subscription_cancelled_at = ?
     WHERE id = ?`,
    [
      tier,
      subscription.current_period_end,
      subscription.cancel_at_period_end ? new Date() : null,
      user.id
    ]
  )

  // Update subscriptions table
  await conn.query(
    `UPDATE subscriptions
     SET status = ?,
         current_period_start = FROM_UNIXTIME(?),
         current_period_end = FROM_UNIXTIME(?),
         cancel_at_period_end = ?
     WHERE stripe_subscription_id = ?`,
    [
      subscription.status,
      subscription.current_period_start,
      subscription.current_period_end,
      subscription.cancel_at_period_end,
      subscriptionId
    ]
  )

  console.log(`Subscription ${subscriptionId} updated: ${subscription.status}`)
}

/**
 * Handle subscription deletion (cancelled and expired)
 * @param {Object} subscription - Stripe subscription object
 * @param {Object} conn - Database connection for transaction
 */
async function handleSubscriptionDeleted(subscription, conn) {
  const customerId = subscription.customer

  // Get user by Stripe customer ID
  const [users] = await conn.query(
    'SELECT id FROM users WHERE stripe_customer_id = ?',
    [customerId]
  )
  const user = users[0]

  if (!user) {
    console.error('No user found for customer:', customerId)
    return
  }

  // Downgrade user to free tier
  await conn.query(
    `UPDATE users
     SET tier = 'free',
         subscription_id = NULL,
         subscription_expires_at = NULL
     WHERE id = ?`,
    [user.id]
  )

  // Update subscription record
  await conn.query(
    `UPDATE subscriptions
     SET status = 'cancelled',
         cancelled_at = NOW()
     WHERE stripe_subscription_id = ?`,
    [subscription.id]
  )

  console.log(`User ${user.id} downgraded to free tier`)
}

/**
 * Handle failed payment
 * @param {Object} invoice - Stripe invoice object
 * @param {Object} conn - Database connection for transaction
 */
async function handlePaymentFailed(invoice, conn) {
  const customerId = invoice.customer
  const subscriptionId = invoice.subscription

  // Get user by Stripe customer ID
  const [users] = await conn.query(
    'SELECT id, email FROM users WHERE stripe_customer_id = ?',
    [customerId]
  )
  const user = users[0]

  if (!user) {
    console.error('No user found for customer:', customerId)
    return
  }

  // Update subscription status
  await conn.query(
    `UPDATE subscriptions
     SET status = 'past_due'
     WHERE stripe_subscription_id = ?`,
    [subscriptionId]
  )

  // TODO: Send email notification about failed payment
  console.log(`Payment failed for user ${user.id} (${user.email})`)
}

/**
 * Handle successful invoice payment (renewal)
 * @param {Object} invoice - Stripe invoice object
 * @param {Object} conn - Database connection for transaction
 */
async function handleInvoicePaid(invoice, conn) {
  const customerId = invoice.customer
  const subscriptionId = invoice.subscription

  if (!subscriptionId) return // Not a subscription invoice

  // Get user by Stripe customer ID
  const [users] = await conn.query(
    'SELECT id FROM users WHERE stripe_customer_id = ?',
    [customerId]
  )
  const user = users[0]

  if (!user) {
    return
  }

  // Ensure user is marked as premium
  await conn.query(
    `UPDATE users SET tier = 'premium' WHERE id = ? AND tier != 'premium'`,
    [user.id]
  )

  console.log(`Invoice paid for user ${user.id}`)
}
