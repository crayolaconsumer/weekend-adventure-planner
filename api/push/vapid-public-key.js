/**
 * GET /api/push/vapid-public-key
 *
 * Returns the VAPID public key for push subscriptions
 */

/* global process */
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'push:vapid')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  // VAPID public key should be set in environment variables
  // Generate a key pair using: npx web-push generate-vapid-keys
  const publicKey = process.env.VAPID_PUBLIC_KEY

  if (!publicKey) {
    console.error('VAPID_PUBLIC_KEY not configured')
    return res.status(500).json({ error: 'Push notifications not configured' })
  }

  return res.status(200).json({ publicKey })
}
