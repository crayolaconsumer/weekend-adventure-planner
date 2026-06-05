/**
 * Cron: Promoted-event instant push ("a new event was added near you").
 *
 * Runs every ~15 min. Picks up newly-active, PAID-BOOST promoted events that
 * haven't been pushed yet (push_sent_at IS NULL) and notifies opted-in users
 * within the organiser's purchased radius — once per event, respecting a global
 * per-user frequency cap and UK quiet hours.
 *
 * This is the paid "push_boost" add-on. The weekly digest is a separate, free
 * cron (local-events-digest.js).
 */

import { query } from '../lib/db.js'
import { sendPushToUserWithStats } from '../lib/pushNotifications.js'
import { isFeatureEnabled } from '../lib/flags.js'
import {
  createPlatformBreakdown, mergePlatformBreakdown, recordCronRun, PROMOTED_EVENT_PUSH_JOB
} from '../lib/cronRuns.js'
import { boundingBox, haversineKm, isQuietHoursUk, FREQ_CAP_HOURS } from '../lib/promotedEventPush.js'

const MAX_EVENTS_PER_RUN = 10
const MAX_USERS_PER_EVENT = 5000
const CHUNK_SIZE = 20
const CHUNK_DELAY_MS = 400

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  if (!isVercelCron && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!(await isFeatureEnabled('promotedEventPush'))) {
    return res.status(200).json({ success: true, skipped: 'flag off' })
  }
  // Don't barge in overnight — these events will still be unsent next run.
  if (isQuietHoursUk()) {
    return res.status(200).json({ success: true, skipped: 'quiet hours' })
  }

  let eligibleCount = 0
  let sent = 0
  let failed = 0
  const perPlatform = createPlatformBreakdown()

  try {
    const events = await query(
      `SELECT id, title, venue_name, lat, lng, promo_radius_km, starts_at
       FROM promoted_events
       WHERE status = 'active' AND payment_status = 'paid' AND moderation_status = 'live'
         AND push_boost = 1 AND push_sent_at IS NULL
       ORDER BY updated_at ASC
       LIMIT ?`,
      [MAX_EVENTS_PER_RUN]
    )

    for (const ev of events) {
      const lat = Number(ev.lat)
      const lng = Number(ev.lng)
      const radius = Number(ev.promo_radius_km) || 25
      const box = boundingBox(lat, lng, radius)

      const candidates = await query(
        `SELECT DISTINCT u.id AS user_id, ul.lat AS ulat, ul.lng AS ulng
         FROM users u
         JOIN push_subscriptions ps ON ps.user_id = u.id
         JOIN user_locations ul ON ul.user_id = u.id
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.is_banned = 0
           AND (np.local_events IS NULL OR np.local_events = 1)
           AND ul.lat BETWEEN ? AND ? AND ul.lng BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM promoted_event_pushes pep
                           WHERE pep.user_id = u.id AND pep.promoted_event_id = ?)
           AND NOT EXISTS (SELECT 1 FROM promoted_event_pushes pf
                           WHERE pf.user_id = u.id AND pf.sent_at > DATE_SUB(NOW(), INTERVAL ? HOUR))
         LIMIT ?`,
        [box.minLat, box.maxLat, box.minLng, box.maxLng, ev.id, FREQ_CAP_HOURS, MAX_USERS_PER_EVENT]
      )

      // Precise radius filter (box is only a prefilter).
      const recipients = candidates.filter(c => {
        const d = haversineKm(lat, lng, Number(c.ulat), Number(c.ulng))
        return d != null && d <= radius
      })
      eligibleCount += recipients.length

      const body = pushBody(ev)
      for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
        const chunk = recipients.slice(i, i + CHUNK_SIZE)
        const results = await Promise.allSettled(chunk.map(async (r) => {
          const out = await sendPushToUserWithStats(r.user_id, {
            title: 'New event near you',
            body,
            url: '/events',
            tag: `promoted-event-${ev.id}`,
            interruptionLevel: 'active'
          })
          if (out.success) {
            // Record so the freq cap + per-event dedup hold for future runs.
            await query(
              `INSERT IGNORE INTO promoted_event_pushes (promoted_event_id, user_id, kind)
               VALUES (?, ?, 'instant')`,
              [ev.id, r.user_id]
            )
          }
          return out
        }))
        for (const res2 of results) {
          if (res2.status === 'fulfilled') {
            mergePlatformBreakdown(perPlatform, res2.value.perPlatform)
            if (res2.value.success) sent++; else failed++
          } else { failed++ }
        }
        if (i + CHUNK_SIZE < recipients.length) {
          await new Promise(r => setTimeout(r, CHUNK_DELAY_MS))
        }
      }

      // Mark done regardless of per-user outcomes so we never re-blast an event.
      await query('UPDATE promoted_events SET push_sent_at = NOW() WHERE id = ?', [ev.id])
    }

    await recordCronRun({ jobName: PROMOTED_EVENT_PUSH_JOB, eligibleCount, sentCount: sent, failedCount: failed, perPlatform })
    return res.status(200).json({ success: true, events: events.length, eligible: eligibleCount, sent, failed })
  } catch (err) {
    console.error('[cron] promoted-event-push failed:', err)
    await recordCronRun({ jobName: PROMOTED_EVENT_PUSH_JOB, eligibleCount, sentCount: sent, failedCount: failed, perPlatform, errorMessage: err.message }).catch(() => {})
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}

function pushBody(ev) {
  const when = ev.starts_at ? new Date(ev.starts_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : null
  const where = ev.venue_name ? ` at ${ev.venue_name}` : ''
  return when ? `${ev.title}${where} — ${when}` : `${ev.title}${where}`
}
