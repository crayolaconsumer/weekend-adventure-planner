/**
 * Cron: Weekend Plans Nudge
 *
 * Fires Friday 16:00 UTC (5pm BST May-Oct, 4pm GMT Nov-Apr).
 * Targets users with messaging that fits the end-of-workweek mindset:
 * "got plans yet? — here's a way to make some." Designed to nudge
 * users into thinking about their Saturday/Sunday while they're
 * winding down from work.
 *
 * Pairs with `re-engagement-nudge.js` (Saturday 10:00 UTC). The two
 * crons share the same eligibility logic — lapsed-but-not-lost users
 * with a push subscription — but a different copy register. Saturday
 * is "let's go," Friday is "what's the plan."
 *
 * Cost: zero. FCM/APNS/VAPID are free; the only resource is Vercel
 * function time. At ~10 users/sec dispatch rate, a thousand-user
 * nudge takes ~100 seconds, well inside the Pro plan budget.
 *
 * Targeting (cheap, no expensive joins):
 *   - Has an active push_subscription row
 *   - notification_preferences.weekly_digest = 1 (default)
 *   - user_stats.last_activity_at is NULL or > 72h ago
 *     (don't nudge people who literally just opened the app)
 *   - users.created_at >= 3 days ago (give brand-new users space
 *     to discover organically before pushing)
 *
 * NB on cadence: a user lapsed by Friday will likely still be lapsed
 * by Saturday and get both nudges. That's intentional — two pings
 * across the weekend is the upper-bound spammy-tolerance we're
 * willing to spend on engaged-but-quiet users. If complaints surface,
 * add a `user_stats.last_nudge_at` dedup so each user gets at most
 * one nudge per 36h window.
 */

import { query } from '../lib/db.js'
import {
  createPlatformBreakdown,
  mergePlatformBreakdown,
  recordCronRun,
  WEEKEND_PLANS_NUDGE_JOB
} from '../lib/cronRuns.js'
import { sendPushToUser, sendPushToUserWithStats } from '../lib/pushNotifications.js'
import { waitUntil } from '@vercel/functions'

// Friday-evening copy register. Lighter than Saturday's
// "fancy a wander?" — these lean into the dopamine of clocking off
// for the week, the openness of a weekend not yet planned. No
// emojis (per project house style); body text only.
const NUDGES = [
  { title: 'Got any weekend plans?', body: 'Plan your weekend in a few swipes.' },
  { title: 'Friday already?', body: 'Find somewhere to be tomorrow.' },
  { title: 'Knock-off time.', body: "Pick a place for tomorrow morning." },
  { title: 'Weekend ahead.', body: 'Got an hour to spare and somewhere to go?' },
  { title: 'Happy Friday.', body: 'Find your weekend in under a minute.' },
  { title: 'Plans this weekend?', body: 'Swipe a few places, pick one.' },
  { title: 'Time to roam?', body: "There's a place near you for tomorrow." },
  { title: "Tomorrow's wide open.", body: 'Fill it with somewhere worth going.' },
]

function pickNudge() {
  return NUDGES[Math.floor(Math.random() * NUDGES.length)]
}

export default async function handler(req, res) {
  // Verify cron auth — same pattern as re-engagement-nudge.
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  const isVercelCron = req.headers['x-vercel-cron'] === '1'

  if (!isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let eligibleCount = 0
  let sent = 0
  let failed = 0
  const perPlatform = createPlatformBreakdown()

  try {
    // Eligibility mirrors re-engagement-nudge — share the audience
    // intentionally. DISTINCT on user_id so users with multiple push
    // subscriptions (web + native) only show up once;
    // sendPushToUser fans out internally to all their subscriptions.
    const users = await query(`
      SELECT DISTINCT u.id, u.username
      FROM users u
      INNER JOIN push_subscriptions ps ON ps.user_id = u.id
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      LEFT JOIN user_stats us ON us.user_id = u.id
      WHERE u.is_banned = 0
        AND u.created_at < DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND (np.weekly_digest IS NULL OR np.weekly_digest = 1)
        AND (us.last_activity_at IS NULL
             OR us.last_activity_at < DATE_SUB(NOW(), INTERVAL 72 HOUR))
    `)
    eligibleCount = users.length

    if (users.length === 0) {
      await recordCronRun({
        jobName: WEEKEND_PLANS_NUDGE_JOB,
        eligibleCount,
        sentCount: sent,
        failedCount: failed,
        perPlatform
      })
      return res.status(200).json({
        success: true,
        message: 'No eligible users for weekend-plans nudge',
        eligible: eligibleCount,
        sent: 0,
        failed: 0,
        perPlatform
      })
    }

    const CHUNK_SIZE = 20
    const CHUNK_DELAY_MS = 500

    for (let i = 0; i < users.length; i += CHUNK_SIZE) {
      const chunk = users.slice(i, i + CHUNK_SIZE)
      const results = await Promise.allSettled(
        chunk.map(u => {
          const nudge = pickNudge()
          return sendPushToUserWithStats(u.id, {
            title: nudge.title,
            body: nudge.body,
            url: '/',
            tag: 'weekend-plans',
            // Friday-evening engagement nudge — important enough to
            // try to surface, but not urgent. 'active' (default) lets
            // iOS Focus modes silence it. We don't want to barge in
            // on someone's work-finishing Focus session.
            interruptionLevel: 'active'
          })
        })
      )

      for (const r of results) {
        if (r.status === 'fulfilled') {
          mergePlatformBreakdown(perPlatform, r.value.perPlatform)
          if (r.value.success) sent++
          else failed++
        } else {
          failed++
          console.error('[cron] weekend-plans-nudge dispatch failed:', r.reason?.message || r.reason)
        }
      }

      if (i + CHUNK_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS))
      }
    }

    await recordCronRun({
      jobName: WEEKEND_PLANS_NUDGE_JOB,
      eligibleCount,
      sentCount: sent,
      failedCount: failed,
      perPlatform
    })

    if (eligibleCount > 0 && sent / eligibleCount < 0.05) {
      waitUntil(
        sendPushToUser(1, {
          title: 'ROAM weekend cron warning',
          body: `Weekend-plans nudge delivered to ${sent}/${eligibleCount} eligible users.`,
          url: '/profile?tab=settings&diagnostics=1',
          tag: 'cron-warning',
          interruptionLevel: 'time-sensitive'
        }).catch(err => {
          console.error('[cron] owner weekend warning push failed:', err?.message || err)
        })
      )
    }

    return res.status(200).json({
      success: true,
      message: 'Weekend-plans nudge dispatched',
      eligible: eligibleCount,
      sent,
      failed,
      perPlatform
    })
  } catch (err) {
    console.error('[cron] weekend-plans-nudge failed:', err)
    try {
      await recordCronRun({
        jobName: WEEKEND_PLANS_NUDGE_JOB,
        eligibleCount,
        sentCount: sent,
        failedCount: Math.max(failed, eligibleCount - sent),
        perPlatform,
        errorMessage: err.message
      })
    } catch (recordErr) {
      console.error('[cron] failed to record weekend-plans run:', recordErr?.message || recordErr)
    }
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
