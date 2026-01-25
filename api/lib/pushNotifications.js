/**
 * Push Notification Utilities
 *
 * Server-side functions for sending push notifications.
 *
 * SETUP REQUIRED:
 * 1. npm install web-push
 * 2. npx web-push generate-vapid-keys
 * 3. Add to environment:
 *    VAPID_PUBLIC_KEY=...
 *    VAPID_PRIVATE_KEY=...
 *    VAPID_SUBJECT=mailto:hello@go-roam.uk
 * 4. Create database table (see documents/PUSH_NOTIFICATIONS_SETUP.md)
 */

/* global process */
import { query, queryOne } from './db.js'

/**
 * Check if a user has a specific notification type enabled
 * @param {number} userId - User ID to check
 * @param {string} notificationType - Column name in notification_preferences table
 * @returns {Promise<boolean>} Whether the notification type is enabled
 */
async function isNotificationEnabled(userId, notificationType) {
  const prefs = await queryOne(
    `SELECT ${notificationType} as enabled FROM notification_preferences WHERE user_id = ?`,
    [userId]
  )
  // Default to true if no preferences set (new users)
  return prefs ? !!prefs.enabled : true
}

// Lazy-load web-push to allow the app to run without it installed
let webpush = null

async function getWebPush() {
  if (!webpush) {
    try {
      webpush = await import('web-push')
      webpush = webpush.default || webpush

      // Configure VAPID
      const publicKey = process.env.VAPID_PUBLIC_KEY
      const privateKey = process.env.VAPID_PRIVATE_KEY
      const subject = process.env.VAPID_SUBJECT || 'mailto:hello@go-roam.uk'

      if (publicKey && privateKey) {
        webpush.setVapidDetails(subject, publicKey, privateKey)
      } else {
        console.warn('VAPID keys not configured - push notifications disabled')
        webpush = null
      }
    } catch (err) {
      console.warn('web-push not installed - push notifications disabled')
      webpush = null
    }
  }
  return webpush
}

/**
 * Send a push notification to a specific user
 * @param {number} userId - User ID to send notification to
 * @param {Object} payload - Notification payload
 * @param {string} payload.title - Notification title
 * @param {string} payload.body - Notification body text
 * @param {string} [payload.icon] - Icon URL
 * @param {string} [payload.url] - URL to open when clicked
 * @param {string} [payload.tag] - Notification tag (for grouping)
 * @returns {Promise<boolean>} Success status
 */
export async function sendPushToUser(userId, payload) {
  const push = await getWebPush()
  if (!push) return false

  try {
    // Get user's subscriptions
    const subscriptions = await query(
      `SELECT endpoint, p256dh_key, auth_key
       FROM push_subscriptions
       WHERE user_id = ?`,
      [userId]
    )

    if (!subscriptions || subscriptions.length === 0) {
      return false
    }

    const notification = {
      title: payload.title || 'ROAM',
      body: payload.body,
      icon: payload.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag || 'roam-notification',
      data: {
        url: payload.url || '/'
      }
    }

    // Send to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh_key,
            auth: sub.auth_key
          }
        }

        try {
          await push.sendNotification(
            pushSubscription,
            JSON.stringify(notification)
          )
          return true
        } catch (err) {
          // Handle expired subscriptions
          if (err.statusCode === 404 || err.statusCode === 410) {
            await query(
              'DELETE FROM push_subscriptions WHERE endpoint = ?',
              [sub.endpoint]
            )
          }
          throw err
        }
      })
    )

    // Return true if at least one succeeded
    return results.some(r => r.status === 'fulfilled' && r.value === true)
  } catch (err) {
    console.error('Push notification error:', err)
    return false
  }
}

/**
 * Send notification when someone follows a user
 * @param {number} followerId - ID of the user who followed
 * @param {number} followeeId - ID of the user being followed
 * @param {string} followerUsername - Username of the follower
 */
export async function notifyNewFollower(followerId, followeeId, followerUsername) {
  // Check user preferences
  if (!await isNotificationEnabled(followeeId, 'new_follower')) {
    return false
  }

  return sendPushToUser(followeeId, {
    title: 'New Follower',
    body: `@${followerUsername} started following you`,
    url: `/user/${followerUsername}`,
    tag: 'new-follower'
  })
}

/**
 * Send notification when a contribution gets upvoted
 * @param {number} userId - ID of contribution author
 * @param {string} placeName - Name of the place
 * @param {number} newVoteCount - New total vote count
 */
export async function notifyContributionUpvote(userId, placeName, newVoteCount) {
  // Check user preferences (contribution notifications)
  if (!await isNotificationEnabled(userId, 'new_contribution')) {
    return false
  }

  return sendPushToUser(userId, {
    title: 'Your tip is helpful!',
    body: `Your tip about ${placeName} has ${newVoteCount} upvotes`,
    tag: 'contribution-vote'
  })
}

/**
 * Send notification when a follow request is approved
 * @param {number} requesterId - ID of user who requested
 * @param {string} approverUsername - Username who approved
 */
export async function notifyFollowRequestApproved(requesterId, approverUsername) {
  return sendPushToUser(requesterId, {
    title: 'Follow Request Accepted',
    body: `@${approverUsername} accepted your follow request`,
    url: `/user/${approverUsername}`,
    tag: 'follow-approved'
  })
}

/**
 * Send notification when a plan is shared with a user
 * @param {number} userId - ID of user to notify
 * @param {string} sharerUsername - Username who shared the plan
 * @param {string} planName - Name of the shared plan
 * @param {string} shareCode - Share code to view the plan
 */
export async function notifyPlanShared(userId, sharerUsername, planName, shareCode) {
  // Check user preferences
  if (!await isNotificationEnabled(userId, 'plan_shared')) {
    return false
  }

  return sendPushToUser(userId, {
    title: 'Plan Shared With You',
    body: `@${sharerUsername} shared "${planName}" with you`,
    url: `/plan/share/${shareCode}`,
    tag: 'plan-shared'
  })
}

export default {
  sendPushToUser,
  notifyNewFollower,
  notifyContributionUpvote,
  notifyFollowRequestApproved,
  notifyPlanShared
}
