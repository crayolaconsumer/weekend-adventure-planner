/**
 * Cron: Visit Reminders
 *
 * Runs daily at 9am to send push notifications for planned visits.
 * Triggered by Vercel Cron.
 *
 * Security: Only accepts requests with valid CRON_SECRET header
 * or from Vercel's cron infrastructure.
 */

/* global process */
import { notifyPlannedVisit, getPlannedVisitsForToday } from '../lib/pushNotifications.js'

export default async function handler(req, res) {
  // Verify cron secret or Vercel cron header
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET

  // Vercel cron jobs send this header
  const isVercelCron = req.headers['x-vercel-cron'] === '1'

  if (!isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Get all visits planned for today
    const plannedVisits = await getPlannedVisitsForToday()

    if (plannedVisits.length === 0) {
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

    const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length
    const failed = results.filter(r => r.status === 'rejected' || r.value === false).length

    return res.status(200).json({
      success: true,
      message: `Sent ${sent} visit reminders`,
      sent,
      failed,
      total: plannedVisits.length
    })
  } catch (error) {
    console.error('Visit reminders cron error:', error)
    return res.status(500).json({
      error: 'Failed to process visit reminders',
      message: error.message
    })
  }
}
