/**
 * POST /api/push/unsubscribe
 *
 * Remove a push notification subscription
 */

import { getUserFromRequest } from '../lib/auth.js'
import { update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'push:unsubscribe')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const { endpoint, platform } = req.body

    if (!endpoint && !platform) {
      return res.status(400).json({ error: 'Endpoint or platform required' })
    }
    if (platform && !['web', 'ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' })
    }

    const user = await getUserFromRequest(req)
    if (user && endpoint) {
      await update(
        'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
        [endpoint, user.id]
      )
    } else if (user && platform) {
      await update(
        'DELETE FROM push_subscriptions WHERE platform = ? AND user_id = ?',
        [platform, user.id]
      )
    } else if (endpoint) {
      await update(
        'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id IS NULL',
        [endpoint]
      )
    } else {
      return res.status(401).json({ error: 'Authentication required' })
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Push unsubscribe error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export default withCors(handler)
