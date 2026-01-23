/**
 * POST /api/push/unsubscribe
 *
 * Remove a push notification subscription
 */

import { update } from '../lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { endpoint } = req.body

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint required' })
    }

    await update(
      'DELETE FROM push_subscriptions WHERE endpoint = ?',
      [endpoint]
    )

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Push unsubscribe error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
