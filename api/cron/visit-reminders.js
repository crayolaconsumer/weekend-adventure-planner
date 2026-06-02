/**
 * Cron: Visit Reminders
 *
 * Runs daily at 9am to send push notifications for planned visits.
 * Triggered by Vercel Cron.
 *
 * Security: Only accepts requests with valid CRON_SECRET header
 * or from Vercel's cron infrastructure.
 */

import { notifyPlannedVisit, getPlannedVisitsForToday } from '../lib/pushNotifications.js'
import { recordCronRun, VISIT_REMINDERS_JOB } from '../lib/cronRuns.js'

export default async function handler(req, res) {
  // Verify cron secret or Vercel cron header
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET

  // Vercel cron jobs send this header
  const isVercelCron = req.headers['x-vercel-cron'] === '1'

  if (!isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let eligibleCount = 0
  let sent = 0
  let failed = 0

  try {
    // Get all visits planned for today
    const plannedVisits = await getPlannedVisitsForToday()
    eligibleCount = plannedVisits.length

    if (plannedVisits.length === 0) {
      await recordCronRun({
        jobName: VISIT_REMINDERS_JOB,
        eligibleCount,
        sentCount: sent,
        failedCount: failed
      })
      return res.status(200).json({
        success: true,
        message: 'No planned visits for today',
        sent: 0
      })
    }

    // Send notifications
    const results = await Promise.allSettled(
      plannedVisits.map(visit =>
        notifyPlannedVisit(visit.userId, visit.placeName, visit.placeId)
      )
    )

    sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length
    failed = results.filter(r => r.status === 'rejected' || r.value === false).length

    await recordCronRun({
      jobName: VISIT_REMINDERS_JOB,
      eligibleCount,
      sentCount: sent,
      failedCount: failed
    })

    return res.status(200).json({
      success: true,
      message: `Sent ${sent} visit reminders`,
      sent,
      failed,
      total: plannedVisits.length
    })
  } catch (error) {
    console.error('Visit reminders cron error:', error)
    try {
      await recordCronRun({
        jobName: VISIT_REMINDERS_JOB,
        eligibleCount,
        sentCount: sent,
        failedCount: Math.max(failed, eligibleCount - sent),
        errorMessage: error.message
      })
    } catch (recordErr) {
      console.error('[cron] failed to record visit-reminders run:', recordErr?.message || recordErr)
    }
    // Don't echo error.message to the response — this is a cron endpoint
    // but any caller could probe internal errors (DB hostnames, query
    // fragments, etc.). Full detail stays in server logs.
    return res.status(500).json({
      error: 'Failed to process visit reminders'
    })
  }
}
