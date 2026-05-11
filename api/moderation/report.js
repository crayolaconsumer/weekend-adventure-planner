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
 * Flow:
 *   1. Validate + rate-limit + insert the report row
 *   2. Respond 200 to the user (fast — no AI in the user's hot path)
 *   3. waitUntil(processBackground): AI triage → auto-hide if critical →
 *      operator email alert on critical/high severity. Vercel keeps the
 *      function alive until that promise settles.
 */

import { waitUntil } from '@vercel/functions'
import { getUserFromRequest } from '../lib/auth.js'
import { queryOne, insert, update } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { triageReport } from '../lib/moderation-ai.js'
import { sendModerationAlert, shouldAlert } from '../lib/moderation-alerts.js'

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
    const safeReportedUserId = Number.isInteger(reportedUserId) ? reportedUserId : null

    const insertResult = await insert(
      `INSERT INTO content_reports
       (reporter_id, entity_type, entity_id, reported_user_id, reason, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reporterId, entityType, String(entityId), safeReportedUserId, reason, safeDetails]
    )
    const reportId = insertResult?.insertId

    // Hand the AI triage + alert work to waitUntil so it survives past
    // the response. Vercel will keep the function alive until the
    // promise settles (or its own timeout, whichever's sooner) without
    // delaying the client's "thanks!" toast.
    waitUntil(
      processBackground({
        reportId,
        report: {
          id: reportId,
          entity_type: entityType,
          entity_id: String(entityId),
          reported_user_id: safeReportedUserId,
          reason,
          details: safeDetails,
        },
      }).catch(err => console.error('Moderation background work failed:', err))
    )

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Report endpoint error:', err)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to submit report' })
    }
  }
}

/**
 * Background pipeline: hydrate content → triage → auto-hide → alert.
 * Always best-effort. Never throws to the caller.
 */
async function processBackground({ reportId, report }) {
  if (!reportId) return

  // Hydrate the reported content for the AI — only contributions and
  // photos have body text we can show the model. For user/place/review
  // reports we triage on the reporter's words alone.
  let reportedContent = null
  let authorUsername = null
  if (report.entity_type === 'contribution' || report.entity_type === 'photo') {
    const row = await queryOne(
      `SELECT c.content, c.contribution_type, u.username
         FROM contributions c JOIN users u ON c.user_id = u.id
        WHERE c.id = ?`,
      [report.entity_id]
    ).catch(() => null)
    if (row) {
      reportedContent = row.content
      authorUsername = row.username
    }
  } else if (report.entity_type === 'user' && report.reported_user_id) {
    const row = await queryOne(
      `SELECT username FROM users WHERE id = ?`,
      [report.reported_user_id]
    ).catch(() => null)
    authorUsername = row?.username || null
  }

  const triage = await triageReport({
    entityType: report.entity_type,
    userReason: report.reason,
    userDetails: report.details,
    content: reportedContent,
    authorUsername,
  })

  let actionTaken = 'none'

  if (triage) {
    // Auto-hide on critical-severity contributions where the model is
    // explicitly confident. We never auto-action on user reports — those
    // need a human to call a ban.
    if (
      triage.severity === 'critical' &&
      triage.suggestedAction === 'hide' &&
      triage.confidence >= 0.85 &&
      (report.entity_type === 'contribution' || report.entity_type === 'photo')
    ) {
      try {
        await update(
          `UPDATE contributions SET status = 'rejected' WHERE id = ?`,
          [report.entity_id]
        )
        actionTaken = 'auto-hidden'
      } catch (err) {
        console.error('Auto-hide failed:', err)
      }
    }

    await update(
      `UPDATE content_reports
          SET ai_severity = ?, ai_reason = ?, ai_action_taken = ?, ai_triaged_at = NOW()
        WHERE id = ?`,
      [triage.severity, triage.reason.slice(0, 500), actionTaken, reportId]
    ).catch(err => console.error('Failed to persist triage:', err))
  }

  // Decorate the report row passed to the alert sender with the AI fields
  // we just persisted, so the email reflects what's in the DB.
  const hydratedReport = { ...report, ai_action_taken: actionTaken }

  if (shouldAlert(triage)) {
    await sendModerationAlert({
      report: hydratedReport,
      triage,
      reportedContent,
    })
  }
}

export default withCors(handler)
