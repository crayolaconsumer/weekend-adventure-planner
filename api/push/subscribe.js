/**
 * POST /api/push/subscribe
 *
 * Save a push notification subscription
 */

import { getUserFromRequest } from '../lib/auth.js'
import { queryOne, insert, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'push:subscribe')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const { endpoint, keys } = req.body

    if (!endpoint || !keys) {
      return res.status(400).json({ error: 'Invalid subscription data' })
    }

    // Validate endpoint is a valid URL
    try {
      const url = new URL(endpoint)
      if (!['https:', 'http:'].includes(url.protocol)) {
        return res.status(400).json({ error: 'Invalid endpoint URL protocol' })
      }
    } catch {
      return res.status(400).json({ error: 'Invalid endpoint URL' })
    }

    // Validate keys exist and are proper Base64 format
    if (!keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Missing required keys (p256dh and auth)' })
    }

    // Base64 URL-safe characters: A-Z, a-z, 0-9, -, _
    const base64UrlRegex = /^[A-Za-z0-9_-]+$/
    if (!base64UrlRegex.test(keys.p256dh) || !base64UrlRegex.test(keys.auth)) {
      return res.status(400).json({ error: 'Invalid key format - must be Base64 URL-safe encoded' })
    }

    // Get user if authenticated (optional - allow anonymous subscriptions)
    const user = await getUserFromRequest(req)
    const userId = user?.id || null

    // Check if subscription already exists
    const existing = await queryOne(
      'SELECT id FROM push_subscriptions WHERE endpoint = ?',
      [endpoint]
    )

    if (existing) {
      // Update existing subscription
      await update(
        `UPDATE push_subscriptions
         SET p256dh_key = ?, auth_key = ?, user_id = ?, updated_at = NOW()
         WHERE id = ?`,
        [keys.p256dh, keys.auth, userId, existing.id]
      )
    } else {
      // Create new subscription
      await insert(
        `INSERT INTO push_subscriptions (endpoint, p256dh_key, auth_key, user_id)
         VALUES (?, ?, ?, ?)`,
        [endpoint, keys.p256dh, keys.auth, userId]
      )
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Push subscribe error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
