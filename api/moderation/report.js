/**
 * POST /api/moderation/report
 *
 * User-facing endpoint for reporting UGC. Required by App Store Review
 * Guideline 1.2 — apps with user-generated content must include a
 * mechanism to report offensive material and timely responses.
 *
 * Body shape:
 *   {
 *     entityType: 'contribution' | 'user' | 'photo' | 'review' | 'place',
 *     entityId: string,                // the row id being reported
 *     reportedUserId?: number,         // author of the content (if known)
 *     reason: 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence'
 *             | 'misinformation' | 'illegal' | 'other',
 *     details?: string                 // free-text, max 1000 chars
 *   }
 *
 * Rate-limited per IP + per user. Reports are queued for human review;
 * acknowledgment to the reporter happens via the standard support flow
 * (we commit to "timely responses" — Apple's review interpretation is
 * within 24h, so the operator must actually process this queue).
 */

import { getUserFromRequest } from '../lib/auth.js'
import { insert } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

const VALID_ENTITY_TYPES = new Set(['contribution', 'user', 'photo', 'review', 'place'])
const VALID_REASONS = new Set([
  'spam', 'harassment', 'hate', 'sexual',
  'violence', 'misinformation', 'illegal', 'other'
])

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'moderation:report')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const { entityType, entityId, reportedUserId, reason, details } = req.body || {}

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      return res.status(400).json({ error: 'Invalid entityType' })
    }
    if (typeof entityId !== 'string' && typeof entityId !== 'number') {
      return res.status(400).json({ error: 'entityId required' })
    }
    if (!VALID_REASONS.has(reason)) {
      return res.status(400).json({ error: 'Invalid reason' })
    }

    const reporter = await getUserFromRequest(req)
    const reporterId = reporter?.id || null

    const safeDetails = typeof details === 'string' ? details.slice(0, 1000) : null

    await insert(
      `INSERT INTO content_reports
       (reporter_id, entity_type, entity_id, reported_user_id, reason, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        reporterId,
        entityType,
        String(entityId),
        Number.isInteger(reportedUserId) ? reportedUserId : null,
        reason,
        safeDetails
      ]
    )

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Report endpoint error:', err)
    return res.status(500).json({ error: 'Failed to submit report' })
  }
}

export default withCors(handler)
