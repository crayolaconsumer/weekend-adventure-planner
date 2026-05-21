/**
 * Cron: Re-engagement Nudge
 *
 * Sends a gentle "fancy a roam?" push to users who haven't opened the
 * app in a few days. Goal: bring lapsed-but-not-lost users back to
 * the swipe deck without feeling spammy.
 *
 * Schedule: Saturday 10:00 UTC (≈ 10–11 UK morning, sweet spot for
 * weekend-planning). Cron entry in vercel.json.
 *
 * Cost: zero. FCM/APNS are free; the only resource is Vercel function
 * time. At ~10 users/sec dispatch rate, a thousand-user nudge takes
 * ~100 seconds, well inside the 5min hobby plan budget.
 *
 * Targeting (cheap, no expensive joins):
 *   - Has an active push_subscription row
 *   - notification_preferences.weekly_digest = 1 (default)
 *   - user_stats.last_activity_at is NULL or > 72h ago
 *     (don't nudge people who literally just opened the app)
 *   - users.created_at >= 3 days ago (give brand-new users space
 *     to discover organically before pushing)
 *
 * Respects:
 *   - isNotificationEnabled() check via the weekly_digest pref
 *   - waitUntil for clean dispatch lifecycle
 *   - APNS interruption-level = 'passive' (does NOT pierce Focus
 *     modes — re-engagement isn't urgent and shouldn't feel like
 *     a notification at 3am)
 */

import { query } from '../lib/db.js'
import {
  createPlatformBreakdown,
  mergePlatformBreakdown,
  recordCronRun,
  RE_ENGAGEMENT_NUDGE_JOB
} from '../lib/cronRuns.js'
import { sendPushToUser, sendPushToUserWithStats } from '../lib/pushNotifications.js'
import { waitUntil } from '@vercel/functions'

// Curated nudge messages. We rotate through these to avoid feeling
// robotic. Each is brand-warm, gentle, and works year-round. No
// emoji — body text only.
const NUDGES = [
  { title: 'Bored?', body: 'Go roam. Tap to find somewhere new nearby.' },
  { title: 'Free afternoon?', body: 'There\'s a place near you you haven\'t been yet.' },
  { title: 'Looking for something to do?', body: 'Swipe a few places and find your next plan.' },
  { title: 'Fancy a wander?', body: 'Open ROAM and see what\'s on this weekend.' },
  { title: 'Stuck for ideas?', body: 'Your next favourite spot is one swipe away.' },
  { title: 'Plans cancelled?', body: 'Pick a new place to be in under a minute.' },
  { title: 'Got an hour spare?', body: 'See what\'s worth seeing near you.' },
  { title: 'Weekend ahead.', body: 'Find somewhere to roam to.' },
]

function pickNudge() {
  return NUDGES[Math.floor(Math.random() * NUDGES.length)]
}

export default async function handler(req, res) {
  // Verify cron auth — same pattern as visit-reminders.
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
    // Eligible users: have a push sub, weekly_digest pref on
    // (default 1), account is >= 3 days old, and either no
    // recorded activity yet OR last activity > 72h ago.
    //
    // DISTINCT on user_id so users with multiple push subscriptions
    // (web + native) only show up once — sendPushToUser fans out
    // internally to all their subscriptions.
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
        jobName: RE_ENGAGEMENT_NUDGE_JOB,
        eligibleCount,
        sentCount: sent,
        failedCount: failed,
        perPlatform
      })
      return res.status(200).json({
        success: true,
        message: 'No eligible users for nudge',
        eligible: eligibleCount,
        sent: 0,
        failed: 0,
        perPlatform
      })
    }

    // Send in chunks with small spacing to avoid hammering
    // FCM/APNS. Promise.allSettled within a chunk parallelises
    // ~20 sends; pause between chunks. This keeps the function
    // well within Vercel's runtime budget at any realistic scale.
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
            tag: 're-engagement',
            // Don't pierce Focus modes — this isn't urgent.
            interruptionLevel: 'passive'
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
          console.error('[cron] re-engagement-nudge dispatch failed:', r.reason?.message || r.reason)
        }
      }

      if (i + CHUNK_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS))
      }
    }

    await recordCronRun({
      jobName: RE_ENGAGEMENT_NUDGE_JOB,
      eligibleCount,
      sentCount: sent,
      failedCount: failed,
      perPlatform
    })

    if (eligibleCount > 0 && sent / eligibleCount < 0.05) {
      waitUntil(
        sendPushToUser(1, {
          title: 'ROAM nudge cron warning',
          body: `Re-engagement nudge delivered to ${sent}/${eligibleCount} eligible users.`,
          url: '/profile?tab=settings&diagnostics=1',
          tag: 'cron-warning',
          interruptionLevel: 'time-sensitive'
        }).catch(err => {
          console.error('[cron] owner warning push failed:', err?.message || err)
        })
      )
    }

    return res.status(200).json({
      success: true,
      message: `Re-engagement nudge dispatched`,
      eligible: eligibleCount,
      sent,
      failed,
      perPlatform
    })
  } catch (err) {
    console.error('[cron] re-engagement-nudge failed:', err)
    try {
      await recordCronRun({
        jobName: RE_ENGAGEMENT_NUDGE_JOB,
        eligibleCount,
        sentCount: sent,
        failedCount: Math.max(failed, eligibleCount - sent),
        perPlatform,
        errorMessage: err.message
      })
    } catch (recordErr) {
      console.error('[cron] failed to record re-engagement run:', recordErr?.message || recordErr)
    }
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
}
