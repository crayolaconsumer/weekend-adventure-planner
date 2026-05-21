/**
 * POST /api/users/activity
 *
 * Lightweight "app opened / active" heartbeat used by the nudge cron.
 * This is intentionally separate from /api/users/stats so routine app
 * opens do not run badge evaluation or mutate streak counters.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'activity:heartbeat')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    await query(
      `INSERT INTO user_stats (user_id, last_activity_at)
       VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE last_activity_at = VALUES(last_activity_at)`,
      [user.id]
    )

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Activity heartbeat error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export default withCors(handler)
