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

import { query, queryOne } from './db.js'

// Lazy-load apns2 to keep cold-start fast for endpoints that don't push
let apnsClient = null
let apnsClientFailed = false

async function getApnsClient() {
  if (apnsClient) return apnsClient
  if (apnsClientFailed) return null

  // Defensive trim: pasting env-var values into Vercel's web UI often
  // captures a trailing newline. We've been bitten by this twice now —
  // once on APPLE_SIGNIN_SERVICES_ID (silent auth failures), now on
  // APNS_BUNDLE_ID (Apple returns "invalid apns-topic header" because
  // the trailing \n makes the HTTP header malformed). Trim everything.
  const keyId = process.env.APNS_KEY_ID?.trim()
  const teamId = process.env.APPLE_TEAM_ID?.trim()
  const bundleId = (process.env.APNS_BUNDLE_ID || 'com.goroam.app').trim()
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
  // Silent badge-update pushes don't have a title/body, only data.
  // Native (iOS APNS, Android FCM) would render that as "ROAM" with a
  // blank body — worse than nothing. Until we wire proper silent push
  // flags (apns-priority: 5 + content-available: 1 on iOS, FCM
  // data-only message on Android), skip the native platforms entirely
  // for these pushes. The web SW handles them correctly via the
  // data.silent flag.
  const isSilent = !payload?.title && !payload?.body
  if (isSilent && (sub.platform === 'ios' || sub.platform === 'android')) {
    return false
  }

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
    data: { ...(payload.data || {}), url: payload.url || payload.data?.url || '/' }
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
      priority: Priority.immediate,
      // interruption-level=time-sensitive bypasses iOS Focus modes for
      // genuinely time-sensitive pushes (visit reminders, fresh
      // follower notifications). iOS 15+ recognises this; older iOS
      // and apps lacking the time-sensitive entitlement silently
      // downgrade to 'active' (the default), so there's no breakage
      // risk. The entitlement (com.apple.developer.usernotifications.
      // time-sensitive) is worth adding to App.entitlements in a
      // follow-up build — without it the system just treats these as
      // normal-priority and Focus mode may suppress them.
      // Caller can override (e.g. notifyContributionRemoved sets 'passive'
      // for non-urgent moderation notices). Default stays time-sensitive
      // so visit reminders / new-follower pushes still pierce Focus modes.
      interruptionLevel: payload.interruptionLevel || (payload.silent ? 'passive' : 'time-sensitive')
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

// ─── FCM (Android) — HTTP v1 API ─────────────────────────────────
// Google removed the legacy `fcm/send` endpoint + `Authorization: key=`
// auth in 2024. The modern v1 API uses an OAuth2 access token minted
// from the Firebase service account JSON.
//
// Config: set FCM_SERVICE_ACCOUNT_JSON_B64 in Vercel env to the
// base64-encoded JSON service account (downloaded from Firebase
// Console → Project Settings → Service accounts). The raw multi-line
// JSON variant FCM_SERVICE_ACCOUNT_JSON is still supported for back-
// compat, but Vercel's env-var pipeline and Node's --env-file parser
// both mangle quoted multi-line strings containing escaped newlines
// (the \n inside the private_key PEM) — the value silently truncates
// to a single char in some configs. Base64-encoding it removes every
// special character from the env value and is bulletproof.
//
// To set: `base64 < service-account.json | vercel env add FCM_SERVICE_ACCOUNT_JSON_B64 production`
//
// We cache the OAuth access token in memory for ~50 mins (tokens last
// 1h) so cold-starts don't repeatedly mint new ones.

let fcmAccessTokenCache = null // { token, expiresAt }

/** Load the Firebase service-account creds from env, preferring the
 *  base64 variant. Returns parsed object or null if unavailable/invalid. */
function loadFcmCredentials() {
  const b64 = process.env.FCM_SERVICE_ACCOUNT_JSON_B64
  if (b64) {
    try {
      const json = Buffer.from(b64, 'base64').toString('utf8')
      return JSON.parse(json)
    } catch (err) {
      console.error('FCM_SERVICE_ACCOUNT_JSON_B64 failed to decode/parse:', err.message)
      return null
    }
  }
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON:', err.message)
    return null
  }
}

async function getFcmAccessToken() {
  if (fcmAccessTokenCache && fcmAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return fcmAccessTokenCache.token
  }
  const creds = loadFcmCredentials()
  if (!creds) return null
  if (!creds.client_email || !creds.private_key || !creds.project_id) {
    console.error('FCM service account JSON missing required fields')
    return null
  }
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key
    },
    scopes: ['https://www.googleapis.com/auth/firebase.messaging']
  })
  const client = await auth.getClient()
  const { token } = await client.getAccessToken()
  if (!token) return null
  fcmAccessTokenCache = {
    token,
    expiresAt: Date.now() + 50 * 60 * 1000,
    projectId: creds.project_id
  }
  return token
}

function getFcmProjectId() {
  return loadFcmCredentials()?.project_id || null
}

async function dispatchFcm(sub, payload) {
  const accessToken = await getFcmAccessToken()
  const projectId = getFcmProjectId()
  if (!accessToken || !projectId) return false

  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        message: {
          token: sub.endpoint,
          notification: {
            title: payload.title || 'ROAM',
            body: payload.body
          },
          android: {
            // priority=HIGH is what makes Android deliver immediately
            // instead of batching. Without it, normal-priority FCM
            // messages can sit on the device for minutes (until the
            // next sync window) and never wake the screen — testers
            // reported notifications only appearing after unlocking
            // the phone. HIGH bypasses doze mode and shows on the
            // lock screen.
            priority: 'HIGH',
            notification: {
              // Don't override the icon here. The manifest declares
              // ic_stat_notification as default_notification_icon;
              // setting icon: 'ic_launcher' here would force the
              // full-colour launcher icon to be used as the small
              // notification icon, which Android renders as a generic
              // white square. Letting the manifest default win gives
              // us the brand compass mark.
              tag: payload.tag || 'roam-notification',
              // NOTE: NO click_action here. Previously we set it to
              // `payload.url || '/'`, but click_action on FCM is an
              // Android Intent action name — Android tried to launch
              // an activity matching "/" (or any URL string), found
              // nothing, and silently dropped the tap. Removing the
              // field falls back to the default LAUNCHER intent, which
              // opens the app's main activity. Once the app is open,
              // Capacitor's pushNotificationActionPerformed listener
              // (PushTapHandler in App.jsx) fires and routes via React
              // Router using the data.url payload below.
              notification_priority: 'PRIORITY_HIGH',
              default_sound: true
            }
          },
          data: { url: payload.url || '/' }
        }
      })
    })
    if (!res.ok) {
      // v1 returns 'UNREGISTERED' or 'INVALID_ARGUMENT' for dead tokens.
      // Clean those up so we don't keep trying.
      const txt = await res.text()
      if (/UNREGISTERED|INVALID_ARGUMENT|NotRegistered/i.test(txt)) {
        await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id])
      } else {
        console.warn('FCM v1 dispatch non-ok:', res.status, txt.slice(0, 200))
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

  // Truncate long place names — Android wraps mid-line at body text,
  // iOS shows full title but a 60+ char title looks terrible in
  // banner notifications. 32 chars is the sweet spot for both.
  const shortPlace = placeName && placeName.length > 32
    ? `${placeName.slice(0, 32)}…`
    : (placeName || 'a place')

  return sendPushToUser(userId, {
    title: 'Your tip is helpful!',
    body: `${shortPlace} got ${newVoteCount} upvote${newVoteCount === 1 ? '' : 's'}`,
    tag: 'contribution-vote'
  })
}

/**
 * Send notification when a tip gets auto-removed by community downvotes.
 * Author dignity — without this push the tip just silently vanishes from
 * their profile and the place page, which is hostile UX.
 * Gated on 'new_contribution' preference (same bucket as upvote notifs —
 * it's activity about your own tip). Uses passive interruption level so
 * it doesn't pierce Focus modes.
 */
export async function notifyContributionRemoved(userId, placeName) {
  if (!await isNotificationEnabled(userId, 'new_contribution')) {
    return false
  }

  const shortPlace = placeName && placeName.length > 32
    ? `${placeName.slice(0, 32)}…`
    : (placeName || 'a place')

  return sendPushToUser(userId, {
    title: 'Your tip was hidden',
    body: `Your tip about ${shortPlace} was hidden because the community didn't find it helpful. You can write a new one anytime.`,
    tag: 'contribution-removed',
    interruptionLevel: 'passive'
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
  notifyContributionRemoved,
  notifyFollowRequestApproved,
  notifyPlanShared,
  notifyPlannedVisit,
  getPlannedVisitsForToday
}
