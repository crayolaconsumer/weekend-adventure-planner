/**
 * POST /api/push/subscribe
 *
 * Save a push notification subscription
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

async function handler(req, res) {
  // GET — clients (notably the native push toggle) need to know whether
  // a subscription already exists for this user on the calling platform.
  // Without this, the toggle reads as OFF on every app launch even when
  // a valid token is stored and pushes would actually deliver — the UI
  // lies about the subscription state and the user thinks pushes are
  // disabled even though they're not.
  if (req.method === 'GET') {
    const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'push:status')
    if (rateLimitError) {
      return res.status(rateLimitError.status).json(rateLimitError)
    }

    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const platform = typeof req.query.platform === 'string' ? req.query.platform : null
    if (platform && !['web', 'ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' })
    }

    const rows = platform
      ? await query(
          'SELECT id, platform FROM push_subscriptions WHERE user_id = ? AND platform = ?',
          [user.id, platform]
        )
      : await query(
          'SELECT id, platform FROM push_subscriptions WHERE user_id = ?',
          [user.id]
        )

    return res.status(200).json({
      subscribed: rows.length > 0,
      platforms: [...new Set(rows.map(r => r.platform))]
    })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'push:subscribe')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    // Two shapes accepted now:
    //   Web (VAPID):    { endpoint: 'https://...', keys: { p256dh, auth } }
    //   Native iOS:     { platform: 'ios',     token: '<APNS device token hex>' }
    //   Native Android: { platform: 'android', token: '<FCM registration token>' }
    //
    // Native rows store the device token in the `endpoint` column and
    // leave p256dh/auth NULL. The dispatcher branches on platform.
    const body = req.body || {}
    const platform = body.platform || 'web'

    if (!['web', 'ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' })
    }

    let endpoint, p256dhKey = null, authKey = null

    if (platform === 'web') {
      const { endpoint: ep, keys } = body
      if (!ep || !keys) {
        return res.status(400).json({ error: 'Invalid subscription data' })
      }
      try {
        const url = new URL(ep)
        if (!['https:', 'http:'].includes(url.protocol)) {
          return res.status(400).json({ error: 'Invalid endpoint URL protocol' })
        }
      } catch {
        return res.status(400).json({ error: 'Invalid endpoint URL' })
      }
      if (!keys.p256dh || !keys.auth) {
        return res.status(400).json({ error: 'Missing required keys (p256dh and auth)' })
      }
      const base64UrlRegex = /^[A-Za-z0-9_-]+$/
      if (!base64UrlRegex.test(keys.p256dh) || !base64UrlRegex.test(keys.auth)) {
        return res.status(400).json({ error: 'Invalid key format - must be Base64 URL-safe encoded' })
      }
      endpoint = ep
      p256dhKey = keys.p256dh
      authKey = keys.auth
    } else {
      // Native: just a device token
      const token = typeof body.token === 'string' ? body.token.trim() : null
      if (!token) {
        return res.status(400).json({ error: 'Native push registration requires a token' })
      }
      // APNS device tokens are 64 hex chars; FCM tokens are longer (~150+).
      // Validate length defensively so we don't store junk.
      if (platform === 'ios' && !/^[0-9a-fA-F]{64}$/.test(token)) {
        return res.status(400).json({ error: 'iOS push token must be 64 hex characters' })
      }
      if (platform === 'android' && (token.length < 64 || token.length > 500)) {
        return res.status(400).json({ error: 'Android push token length out of range' })
      }
      endpoint = token
    }

    // Get user if authenticated (optional - allow anonymous subscriptions)
    const user = await getUserFromRequest(req)
    const userId = user?.id || null

    // Upsert by endpoint (the unique constraint)
    const existing = await queryOne(
      'SELECT id FROM push_subscriptions WHERE endpoint = ?',
      [endpoint]
    )

    if (existing) {
      await update(
        `UPDATE push_subscriptions
         SET platform = ?, p256dh_key = ?, auth_key = ?, user_id = ?, updated_at = NOW()
         WHERE id = ?`,
        [platform, p256dhKey, authKey, userId, existing.id]
      )
    } else {
      await insert(
        `INSERT INTO push_subscriptions (platform, endpoint, p256dh_key, auth_key, user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [platform, endpoint, p256dhKey, authKey, userId]
      )
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Push subscribe error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export default withCors(handler)
