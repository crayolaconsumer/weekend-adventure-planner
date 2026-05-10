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

// Lazy-load apns2 to keep cold-start fast for endpoints that don't push
let apnsClient = null
let apnsClientFailed = false

async function getApnsClient() {
  if (apnsClient) return apnsClient
  if (apnsClientFailed) return null

  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APPLE_TEAM_ID
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.goroam.app'
  const signingKey = process.env.APNS_AUTH_KEY

  if (!keyId || !teamId || !signingKey) {
    apnsClientFailed = true
    console.warn('APNS env vars missing — iOS native pushes disabled')
    return null
  }

  try {
    const { ApnsClient } = await import('apns2')
    apnsClient = new ApnsClient({
      team: teamId,
      keyId,
      signingKey,
      defaultTopic: bundleId,
      // production = true means apns.apple.com (real devices). Development
      // = sandbox.apns.apple.com (TestFlight/dev builds).
      // Vercel prod env should always send to prod APNS; preview env can
      // be configured separately if we ever need sandbox testing.
      host: process.env.NODE_ENV === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com'
    })
    return apnsClient
  } catch (err) {
    console.warn('APNS client failed to init:', err.message)
    apnsClientFailed = true
    return null
  }
}

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
    } catch {
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
/**
 * Dispatch a push notification across all of a user's subscriptions,
 * branching per platform:
 *   - 'web':     VAPID web push via web-push lib (existing)
 *   - 'ios':     APNS via apns2 + .p8 token-based auth
 *   - 'android': FCM (placeholder — Firebase setup deferred to post-launch)
 *
 * Returns true if at least one delivery succeeded across all subscriptions.
 * Expired tokens (410 / 404 from VAPID, 'BadDeviceToken' / 'Unregistered'
 * from APNS) are auto-deleted from the table.
 */
export async function sendPushToUser(userId, payload) {
  // Pull all subscriptions in one go — much cheaper than per-platform queries
  const subscriptions = await query(
    `SELECT id, platform, endpoint, p256dh_key, auth_key
     FROM push_subscriptions
     WHERE user_id = ?`,
    [userId]
  )

  if (!subscriptions || subscriptions.length === 0) return false

  const results = await Promise.allSettled(
    subscriptions.map((sub) => dispatchToSubscription(sub, payload))
  )

  return results.some(r => r.status === 'fulfilled' && r.value === true)
}

async function dispatchToSubscription(sub, payload) {
  switch (sub.platform) {
    case 'web':
      return dispatchVapid(sub, payload)
    case 'ios':
      return dispatchApns(sub, payload)
    case 'android':
      return dispatchFcm(sub, payload)
    default:
      console.warn(`Unknown push platform '${sub.platform}' for sub ${sub.id}`)
      return false
  }
}

// ─── VAPID web push ──────────────────────────────────────────────

async function dispatchVapid(sub, payload) {
  const push = await getWebPush()
  if (!push) return false
  const notification = {
    title: payload.title || 'ROAM',
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'roam-notification',
    data: { url: payload.url || '/' }
  }
  try {
    await push.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh_key, auth: sub.auth_key }
      },
      JSON.stringify(notification)
    )
    return true
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id])
    }
    return false
  }
}

// ─── APNS (iOS) ──────────────────────────────────────────────────

async function dispatchApns(sub, payload) {
  const client = await getApnsClient()
  if (!client) return false

  try {
    const { Notification, Priority } = await import('apns2')
    const note = new Notification(sub.endpoint, {
      alert: {
        title: payload.title || 'ROAM',
        body: payload.body || ''
      },
      badge: typeof payload.badge === 'number' ? payload.badge : undefined,
      sound: payload.silent ? undefined : 'default',
      data: { url: payload.url || '/' },
      threadId: payload.tag || 'roam-notification',
      priority: Priority.immediate
    })
    await client.send(note)
    return true
  } catch (err) {
    // apns2 throws errors with reason like 'BadDeviceToken', 'Unregistered',
    // 'DeviceTokenNotForTopic'. Clean up dead tokens.
    const reason = err?.reason || err?.message || ''
    if (reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') {
      await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id])
    } else {
      console.error('APNS dispatch error:', reason || err)
    }
    return false
  }
}

// ─── FCM (Android) ───────────────────────────────────────────────
// Placeholder — wires up when FIREBASE_SERVER_KEY env var is added
// and we set up Firebase project. Returns false silently until then
// so Android subscriptions don't error (just don't deliver).

async function dispatchFcm(sub, payload) {
  const fcmKey = process.env.FCM_SERVER_KEY
  if (!fcmKey) return false

  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${fcmKey}`
      },
      body: JSON.stringify({
        to: sub.endpoint,
        notification: {
          title: payload.title || 'ROAM',
          body: payload.body,
          icon: 'ic_launcher',
          tag: payload.tag || 'roam-notification',
          click_action: payload.url || '/'
        },
        data: { url: payload.url || '/' }
      })
    })
    if (!res.ok) {
      // FCM returns 'NotRegistered' or 'InvalidRegistration' for dead tokens
      const txt = await res.text()
      if (/NotRegistered|InvalidRegistration/.test(txt)) {
        await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id])
      }
      return false
    }
    return true
  } catch (err) {
    console.error('FCM dispatch error:', err)
    return false
  }
}

/**
 * Send silent push to update notification badge
 * This sends a background message to the app to update the unread count
 * without showing a visible notification to the user.
 * @param {number} userId - User ID
 * @param {number} unreadCount - Current unread count
 * @returns {Promise<boolean>} Success status
 */
export async function pushNotificationBadge(userId, unreadCount) {
  return sendPushToUser(userId, {
    title: '',  // Silent - no visible notification
    body: '',
    tag: 'badge-update',
    data: {
      type: 'BADGE_UPDATE',
      unreadCount,
      silent: true
    }
  })
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

/**
 * Send reminder notification for a planned visit
 * @param {number} userId - ID of user to notify
 * @param {string} placeName - Name of the place
 * @param {string} placeId - ID of the place for the URL
 */
export async function notifyPlannedVisit(userId, placeName, placeId) {
  // Check user preferences
  if (!await isNotificationEnabled(userId, 'visit_reminder')) {
    return false
  }

  return sendPushToUser(userId, {
    title: `Ready for ${placeName}?`,
    body: "You planned to visit today. Tap to get directions!",
    url: `/wishlist?highlight=${encodeURIComponent(placeId)}`,
    tag: 'visit-reminder'
  })
}

/**
 * Get all planned visits for today that need reminders
 * @returns {Promise<Array>} List of planned visits with user and place info
 */
export async function getPlannedVisitsForToday() {
  // Get visits planned for today (comparing just the date part).
  // Exclude places the user has already actually visited — the modern
  // visit flow writes to visited_places (separate table), not back to
  // saved_places.visited. Without this LEFT JOIN we'd re-remind users
  // about places they've been to.
  const visits = await query(
    `SELECT
       sp.user_id,
       sp.place_id,
       sp.place_data,
       sp.planned_date
     FROM saved_places sp
     LEFT JOIN visited_places vp
       ON vp.user_id = sp.user_id AND vp.place_id = sp.place_id
     WHERE DATE(sp.planned_date) = CURDATE()
       AND (sp.visited = 0 OR sp.visited IS NULL)
       AND vp.id IS NULL`,
    []
  )

  return visits.map(row => {
    let placeData = {}
    try {
      if (typeof row.place_data === 'string') {
        placeData = JSON.parse(row.place_data)
      } else if (row.place_data) {
        placeData = row.place_data
      }
    } catch {
      // Ignore parse errors
    }

    return {
      userId: row.user_id,
      placeId: row.place_id,
      placeName: placeData.name || 'your planned place',
      plannedDate: row.planned_date
    }
  })
}

export default {
  sendPushToUser,
  pushNotificationBadge,
  notifyNewFollower,
  notifyContributionUpvote,
  notifyFollowRequestApproved,
  notifyPlanShared,
  notifyPlannedVisit,
  getPlannedVisitsForToday
}
