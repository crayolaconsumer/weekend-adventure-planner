/**
 * Cron: Local events weekly digest ("what's on near you").
 *
 * Fires weekly (Thursday teatime). For each opted-in user with a known coarse
 * location, bundles the Featured events near them starting in the next 7 days
 * into a SINGLE push. Free (the platform's value), capped to once per ~week per
 * user via user_locations.last_local_digest_at, and silent in quiet hours.
 */

import { query } from '../lib/db.js'
import { sendPushToUserWithStats } from '../lib/pushNotifications.js'
import { isFeatureEnabled } from '../lib/flags.js'
import {
  createPlatformBreakdown, mergePlatformBreakdown, recordCronRun, LOCAL_EVENTS_DIGEST_JOB
} from '../lib/cronRuns.js'
import { haversineKm, isQuietHoursUk, DIGEST_RADIUS_KM } from '../lib/promotedEventPush.js'

const MAX_USERS_PER_RUN = 2000
const CHUNK_SIZE = 20
const CHUNK_DELAY_MS = 400
const DIGEST_COOLDOWN_DAYS = 6

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  if (!isVercelCron && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!(await isFeatureEnabled('promotedEventPush'))) {
    return res.status(200).json({ success: true, skipped: 'flag off' })
  }
  if (isQuietHoursUk()) {
    return res.status(200).json({ success: true, skipped: 'quiet hours' })
  }

  let eligibleCount = 0
  let sent = 0
  let failed = 0
  const perPlatform = createPlatformBreakdown()

  try {
    // All currently-servable Featured events starting within 7 days. At launch
    // scale this is small, so we fetch once and match users in memory.
    const events = await query(
      `SELECT id, title, lat, lng, promo_radius_km
       FROM promoted_events
       WHERE status = 'active' AND payment_status = 'paid' AND moderation_status = 'live'
         AND promo_starts_on <= CURDATE() AND promo_ends_on >= CURDATE()
         AND starts_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)`
    )

    if (events.length === 0) {
      await recordCronRun({ jobName: LOCAL_EVENTS_DIGEST_JOB, eligibleCount: 0, sentCount: 0, failedCount: 0, perPlatform })
      return res.status(200).json({ success: true, message: 'no upcoming featured events' })
    }

    const users = await query(
      `SELECT DISTINCT u.id AS user_id, ul.lat AS ulat, ul.lng AS ulng
       FROM users u
       JOIN push_subscriptions ps ON ps.user_id = u.id
       JOIN user_locations ul ON ul.user_id = u.id
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.is_banned = 0
         AND u.created_at < DATE_SUB(NOW(), INTERVAL 3 DAY)
         AND (np.local_events IS NULL OR np.local_events = 1)
         AND (ul.last_local_digest_at IS NULL
              OR ul.last_local_digest_at < DATE_SUB(NOW(), INTERVAL ${DIGEST_COOLDOWN_DAYS} DAY))
       LIMIT ${MAX_USERS_PER_RUN}`
    )

    // Build each user's nearby set (within both the event's paid radius and the
    // digest radius), then push only to users with at least one match.
    const targets = []
    for (const u of users) {
      const ulat = Number(u.ulat)
      const ulng = Number(u.ulng)
      const near = events.filter(ev => {
        const d = haversineKm(ulat, ulng, Number(ev.lat), Number(ev.lng))
        return d != null && d <= Math.min(Number(ev.promo_radius_km) || DIGEST_RADIUS_KM, DIGEST_RADIUS_KM)
      })
      if (near.length > 0) targets.push({ userId: u.user_id, near })
    }
    eligibleCount = targets.length

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      const chunk = targets.slice(i, i + CHUNK_SIZE)
      const results = await Promise.allSettled(chunk.map(async (t) => {
        const out = await sendPushToUserWithStats(t.userId, {
          title: "What's on near you",
          body: digestBody(t.near),
          url: '/events',
          tag: 'local-events-digest',
          interruptionLevel: 'active'
        })
        // Cooldown is set whether or not the device accepted — avoids hammering
        // a user every weekly run; they re-enter the pool after the cooldown.
        await query('UPDATE user_locations SET last_local_digest_at = NOW() WHERE user_id = ?', [t.userId])
        return out
      }))
      for (const r of results) {
        if (r.status === 'fulfilled') {
          mergePlatformBreakdown(perPlatform, r.value.perPlatform)
          if (r.value.success) sent++; else failed++
        } else { failed++ }
      }
      if (i + CHUNK_SIZE < targets.length) await new Promise(r => setTimeout(r, CHUNK_DELAY_MS))
    }

    await recordCronRun({ jobName: LOCAL_EVENTS_DIGEST_JOB, eligibleCount, sentCount: sent, failedCount: failed, perPlatform })
    return res.status(200).json({ success: true, events: events.length, eligible: eligibleCount, sent, failed })
  } catch (err) {
    console.error('[cron] local-events-digest failed:', err)
    await recordCronRun({ jobName: LOCAL_EVENTS_DIGEST_JOB, eligibleCount, sentCount: sent, failedCount: failed, perPlatform, errorMessage: err.message }).catch(() => {})
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}

function digestBody(near) {
  const n = near.length
  if (n === 1) return `${near[0].title} — tap to see what's on`
  return `${n} featured events near you, including ${near[0].title}`
}
