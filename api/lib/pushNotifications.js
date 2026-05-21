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
import { createPlatformBreakdown } from './cronRuns.js'

const URL_SAFE_BASE64_RE = /^[A-Za-z0-9_-]+$/
const APPLE_ID_RE = /^[A-Za-z0-9]{10}$/
const REVERSE_DNS_RE = /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*){2,}$/

function trimEnvValue(name) {
  if (typeof process.env[name] !== 'string') return undefined
  const trimmed = process.env[name].trim()
  process.env[name] = trimmed
  return trimmed
}

function parseFcmCredentialsFromEnv(env = process.env) {
  const b64 = typeof env.FCM_SERVICE_ACCOUNT_JSON_B64 === 'string'
    ? env.FCM_SERVICE_ACCOUNT_JSON_B64.trim()
    : ''
  if (b64) {
    const json = Buffer.from(b64, 'base64').toString('utf8')
    return JSON.parse(json)
  }

  const raw = typeof env.FCM_SERVICE_ACCOUNT_JSON === 'string'
    ? env.FCM_SERVICE_ACCOUNT_JSON.trim()
    : ''
  if (!raw) return null
  return JSON.parse(raw)
}

export function validatePushEnvironment(env = process.env, { applyTrim = false, logFailures = false } = {}) {
  const read = (name) => {
    const value = typeof env[name] === 'string' ? env[name].trim() : ''
    if (applyTrim && typeof env[name] === 'string') env[name] = value
    return value
  }

  const vapidErrors = []
  const vapidPublicKey = read('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = read('VAPID_PRIVATE_KEY')
  const vapidSubject = read('VAPID_SUBJECT')
  if (!URL_SAFE_BASE64_RE.test(vapidPublicKey) || vapidPublicKey.length !== 87) {
    vapidErrors.push('VAPID_PUBLIC_KEY must be 87 chars URL-safe base64')
  }
  if (!URL_SAFE_BASE64_RE.test(vapidPrivateKey) || vapidPrivateKey.length !== 43) {
    vapidErrors.push('VAPID_PRIVATE_KEY must be 43 chars URL-safe base64')
  }
  if (!vapidSubject.startsWith('mailto:') && !vapidSubject.startsWith('https://')) {
    vapidErrors.push('VAPID_SUBJECT must start with mailto: or https://')
  }

  const apnsErrors = []
  const apnsKeyId = read('APNS_KEY_ID')
  const apnsTeamId = read('APNS_TEAM_ID') || read('APPLE_TEAM_ID')
  const apnsBundleId = read('APNS_BUNDLE_ID')
  const apnsAuthKey = read('APNS_AUTH_KEY')
  if (!APPLE_ID_RE.test(apnsKeyId)) {
    apnsErrors.push('APNS_KEY_ID must be exactly 10 alphanumeric chars')
  }
  if (!APPLE_ID_RE.test(apnsTeamId)) {
    apnsErrors.push('APNS_TEAM_ID must be exactly 10 alphanumeric chars')
  }
  if (!REVERSE_DNS_RE.test(apnsBundleId)) {
    apnsErrors.push('APNS_BUNDLE_ID must look like a reverse-DNS bundle id')
  }
  if (!apnsAuthKey.includes('-----BEGIN PRIVATE KEY-----') || !apnsAuthKey.endsWith('-----END PRIVATE KEY-----')) {
    apnsErrors.push('APNS_AUTH_KEY must contain BEGIN PRIVATE KEY and end with END PRIVATE KEY')
  }

  const fcmErrors = []
  try {
    const creds = parseFcmCredentialsFromEnv(env)
    if (!creds) {
      fcmErrors.push('FCM_SERVICE_ACCOUNT_JSON_B64 or FCM_SERVICE_ACCOUNT_JSON must be configured')
    } else {
      if (!creds.client_email) fcmErrors.push('FCM service account JSON missing client_email')
      if (!creds.private_key) fcmErrors.push('FCM service account JSON missing private_key')
      if (!creds.project_id) fcmErrors.push('FCM service account JSON missing project_id')
    }
  } catch (err) {
    fcmErrors.push(`FCM service account JSON failed to parse: ${err.message}`)
  }

  const result = {
    validation: {
      vapid: vapidErrors.length === 0 ? 'ok' : 'error',
      apns: apnsErrors.length === 0 ? 'ok' : 'error',
      fcm: fcmErrors.length === 0 ? 'ok' : 'error'
    },
    errors: {
      vapid: vapidErrors,
      apns: apnsErrors,
      fcm: fcmErrors
    }
  }

  if (logFailures) {
    for (const platform of ['vapid', 'apns', 'fcm']) {
      if (result.validation[platform] !== 'ok') {
        console.error(`Push ${platform.toUpperCase()} validation failed: ${result.errors[platform].join('; ')}`)
      }
    }
  }

  return result
}

const pushValidationStatus = validatePushEnvironment(process.env, {
  applyTrim: true,
  logFailures: true
})

export function getPushValidationStatus() {
  return {
    validation: { ...pushValidationStatus.validation },
    errors: {
      vapid: [...pushValidationStatus.errors.vapid],
      apns: [...pushValidationStatus.errors.apns],
      fcm: [...pushValidationStatus.errors.fcm]
    }
  }
}

function requirePushPlatform(platform) {
  const key = platform === 'web' ? 'vapid' : platform
  const errors = pushValidationStatus.errors[key] || []
  if (errors.length > 0) {
    throw new Error(`Push ${key.toUpperCase()} credentials invalid: ${errors.join('; ')}`)
  }
}

function isMissingApnsEnvColumn(err) {
  return (err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054) &&
    /apns_env/i.test(err?.message || '')
}

async function getUserPushSubscriptions(userId, { includeCreatedAt = false } = {}) {
  const createdAtColumn = includeCreatedAt ? ', created_at' : ''
  try {
    return await query(
      `SELECT id, platform, apns_env, endpoint, p256dh_key, auth_key${createdAtColumn}
       FROM push_subscriptions
       WHERE user_id = ?`,
      [userId]
    )
  } catch (err) {
    if (!isMissingApnsEnvColumn(err)) throw err
    console.warn('push_subscriptions.apns_env column missing; dispatching without APNS env cache')
    const rows = await query(
      `SELECT id, platform, endpoint, p256dh_key, auth_key${createdAtColumn}
       FROM push_subscriptions
       WHERE user_id = ?`,
      [userId]
    )
    return rows.map(row => ({ ...row, apns_env: null }))
  }
}

async function stampApnsEnv(subId, env) {
  try {
    await query('UPDATE push_subscriptions SET apns_env = ? WHERE id = ?', [env, subId])
  } catch (err) {
    if (!isMissingApnsEnvColumn(err)) throw err
    console.warn('push_subscriptions.apns_env column missing; APNS env stamp skipped')
  }
}

// APNS clients per environment. iOS device tokens are valid against
// exactly one of (production, sandbox) depending on how the app was
// signed — TestFlight + App Store builds → production; Xcode USB +
// debug builds → sandbox. Same hex token string in both, different
// upstream registry. Sending to the wrong host returns BadDeviceToken
// and silently drops the push, so we keep both clients alive and let
// the dispatcher try one or both.
const APNS_HOSTS = {
  production: 'api.push.apple.com',
  sandbox: 'api.sandbox.push.apple.com'
}
const apnsClients = { production: null, sandbox: null }
let apnsClientFailed = false

async function getApnsClient(env = 'production') {
  if (apnsClients[env]) return apnsClients[env]
  if (apnsClientFailed) return null
  if (!APNS_HOSTS[env]) {
    console.warn(`Unknown APNS env '${env}', defaulting to production`)
    env = 'production'
  }

  const keyId = trimEnvValue('APNS_KEY_ID')
  const teamId = trimEnvValue('APNS_TEAM_ID') || trimEnvValue('APPLE_TEAM_ID')
  const bundleId = trimEnvValue('APNS_BUNDLE_ID')
  const signingKey = trimEnvValue('APNS_AUTH_KEY')

  if (!keyId || !teamId || !signingKey) {
    apnsClientFailed = true
    console.warn('APNS env vars missing — iOS native pushes disabled')
    return null
  }

  try {
    const { ApnsClient } = await import('apns2')
    apnsClients[env] = new ApnsClient({
      team: teamId,
      keyId,
      signingKey,
      defaultTopic: bundleId,
      host: APNS_HOSTS[env]
    })
    return apnsClients[env]
  } catch (err) {
    console.warn(`APNS ${env} client failed to init:`, err.message)
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
      const publicKey = trimEnvValue('VAPID_PUBLIC_KEY')
      const privateKey = trimEnvValue('VAPID_PRIVATE_KEY')
      const subject = trimEnvValue('VAPID_SUBJECT')

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
 *   - 'android': FCM v1 HTTP API, signed via service-account JSON in env
 *
 * Returns true if at least one delivery succeeded across all subscriptions.
 * Expired tokens (410 / 404 from VAPID, 'BadDeviceToken' / 'Unregistered'
 * from APNS) are auto-deleted from the table.
 */
export async function sendPushToUser(userId, payload) {
  const stats = await sendPushToUserWithStats(userId, payload)
  return stats.success
}

export async function sendPushToUserWithStats(userId, payload) {
  const subscriptions = await getUserPushSubscriptions(userId)

  if (!subscriptions || subscriptions.length === 0) {
    return {
      success: false,
      subscriptionCount: 0,
      perPlatform: createPlatformBreakdown(),
      results: []
    }
  }

  const results = await Promise.allSettled(
    subscriptions.map((sub) => dispatchToSubscriptionDetailed(sub, payload))
  )

  const detailedResults = []
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Push dispatch failed:', result.reason?.message || result.reason)
      detailedResults.push({
        id: null,
        platform: 'unknown',
        endpoint_prefix: '',
        success: false,
        status: null,
        reason: result.reason?.message || 'Push dispatch failed'
      })
    } else {
      detailedResults.push(result.value)
    }
  }

  const perPlatform = createPlatformBreakdown()
  for (const result of detailedResults) {
    if (!perPlatform[result.platform]) continue
    if (result.success) perPlatform[result.platform].sent++
    else perPlatform[result.platform].failed++
  }

  return {
    success: detailedResults.some(result => result.success),
    subscriptionCount: subscriptions.length,
    perPlatform,
    results: detailedResults
  }
}

export async function sendDiagnosticPushToUser(userId) {
  const subscriptions = await getUserPushSubscriptions(userId, { includeCreatedAt: true })

  const payload = {
    title: 'ROAM push test',
    body: 'Diagnostic notification delivered.',
    url: '/profile?tab=settings&diagnostics=1',
    tag: 'push-diagnostic'
  }

  const results = await Promise.all(
    subscriptions.map((sub) => dispatchToSubscriptionDetailed(sub, payload))
  )

  return { subscriptions, results }
}

async function dispatchToSubscriptionDetailed(sub, payload) {
  try {
    const result = await dispatchToSubscriptionWithStatus(sub, payload)
    return {
      id: sub.id,
      platform: sub.platform,
      endpoint_prefix: formatEndpointPrefix(sub.endpoint),
      ...result
    }
  } catch (err) {
    return {
      id: sub.id,
      platform: sub.platform,
      endpoint_prefix: formatEndpointPrefix(sub.endpoint),
      success: false,
      status: null,
      reason: err.message || 'Unknown push dispatch error'
    }
  }
}

async function dispatchToSubscriptionWithStatus(sub, payload) {
  const isSilent = !payload?.title && !payload?.body
  if (isSilent && (sub.platform === 'ios' || sub.platform === 'android')) {
    return { success: false, status: null, reason: 'Silent native pushes are intentionally skipped' }
  }

  switch (sub.platform) {
    case 'web':
      return dispatchVapidDetailed(sub, payload)
    case 'ios':
      return dispatchApnsDetailed(sub, payload)
    case 'android':
      return dispatchFcmDetailed(sub, payload)
    default:
      return { success: false, status: null, reason: `Unknown push platform '${sub.platform}'` }
  }
}

export function formatEndpointPrefix(endpoint) {
  if (!endpoint) return ''
  return endpoint.length <= 36 ? endpoint : `${endpoint.slice(0, 36)}...`
}

// ─── VAPID web push ──────────────────────────────────────────────

async function dispatchVapidDetailed(sub, payload) {
  requirePushPlatform('web')
  const push = await getWebPush()
  if (!push) return { success: false, status: null, reason: 'web-push client unavailable' }
  const notification = {
    title: payload.title || 'ROAM',
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'roam-notification',
    data: { ...(payload.data || {}), url: payload.url || payload.data?.url || '/' }
  }
  try {
    const response = await push.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh_key, auth: sub.auth_key }
      },
      JSON.stringify(notification)
    )
    return { success: true, status: response?.statusCode || 201, reason: null }
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id])
    }
    return {
      success: false,
      status: err.statusCode || null,
      reason: err.body || err.message || 'VAPID dispatch failed'
    }
  }
}

// ─── APNS (iOS) ──────────────────────────────────────────────────

// Errors that mean "this token doesn't exist in the env you sent to".
// We treat these as "try the other env" rather than "delete the token,"
// because the same hex token might be valid against the OTHER host
// (debug-build tokens live in sandbox, App Store / TestFlight tokens
// live in production — apns2 returns the same error code in both
// "wrong host" cases).
const APNS_WRONG_ENV_REASONS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic'
])

async function sendOnceToApns(env, sub, payload) {
  requirePushPlatform('ios')
  const client = await getApnsClient(env)
  if (!client) return { success: false, status: null, reason: 'APNS client unavailable', env }

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
      // See note below the dispatchApnsDetailed block on interruption levels.
      interruptionLevel: payload.interruptionLevel || (payload.silent ? 'passive' : 'time-sensitive')
    })
    const response = await client.send(note)
    return { success: true, status: response?.statusCode || 200, reason: null, env }
  } catch (err) {
    const reason = err?.reason || err?.message || ''
    return {
      success: false,
      status: err?.statusCode || err?.status || null,
      reason: reason || 'APNS dispatch failed',
      env
    }
  }
}

// Tries the env stamped on the sub first; if that returns a
// wrong-env reason (BadDeviceToken / Unregistered / DeviceTokenNotForTopic),
// falls back to the other env. On success, stamps the working env on
// the sub so subsequent dispatches go straight to the right host. Only
// deletes the sub if BOTH envs reject — that's the only point at which
// we know the token is genuinely dead, not just attached to the wrong
// host.
//
// The classic silent-failure mode this fixes: a user installed a debug
// build at some point, iOS registered the device token against sandbox
// APNS. They later install a TestFlight build, but iOS re-uses the same
// token + still has it registered in sandbox. Production APNS replies
// BadDeviceToken; we used to delete the row + the next nudge cron found
// no subscription + the user heard nothing. Now we try sandbox, succeed,
// stamp `apns_env='sandbox'`, and the user gets their nudge.
async function dispatchApnsDetailed(sub, payload) {
  const preferredEnv = sub.apns_env || 'production'
  const fallbackEnv = preferredEnv === 'production' ? 'sandbox' : 'production'

  const primary = await sendOnceToApns(preferredEnv, sub, payload)
  if (primary.success) {
    // First send against the preferred env worked. If the sub didn't
    // have a stamped env yet, stamp it now so we don't have to retry
    // again next time.
    if (!sub.apns_env) {
      await stampApnsEnv(sub.id, primary.env)
    }
    return primary
  }

  // Only retry the other env on wrong-env reasons. Other errors
  // (network, BadJwt, etc.) wouldn't be solved by switching host.
  if (!APNS_WRONG_ENV_REASONS.has(primary.reason)) {
    console.error(`APNS ${primary.env} dispatch error:`, primary.reason)
    return primary
  }

  const fallback = await sendOnceToApns(fallbackEnv, sub, payload)
  if (fallback.success) {
    await stampApnsEnv(sub.id, fallback.env)
    return fallback
  }

  // Both envs rejected with wrong-env-style errors → the token is
  // genuinely dead in both registries. Clean it up so the next sub
  // for this user gets a fresh row.
  if (APNS_WRONG_ENV_REASONS.has(fallback.reason)) {
    await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id])
  } else {
    console.error(`APNS ${fallback.env} fallback error:`, fallback.reason)
  }
  return fallback
}

/*
 * interruption-level=time-sensitive bypasses iOS Focus modes for
 * genuinely time-sensitive pushes (visit reminders, fresh follower
 * notifications). iOS 15+ recognises this; older iOS + apps lacking
 * the time-sensitive entitlement silently downgrade to 'active' (the
 * default), so there's no breakage risk. The entitlement
 * (com.apple.developer.usernotifications.time-sensitive) is declared
 * in ios/App/App/App.entitlements. Caller can override (e.g.
 * notifyContributionRemoved sets 'passive' for non-urgent moderation
 * notices). Default stays time-sensitive so visit reminders / new-
 * follower pushes still pierce Focus modes.
 */

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
  const b64 = trimEnvValue('FCM_SERVICE_ACCOUNT_JSON_B64')
  if (b64) {
    try {
      const json = Buffer.from(b64, 'base64').toString('utf8')
      return JSON.parse(json)
    } catch (err) {
      console.error('FCM_SERVICE_ACCOUNT_JSON_B64 failed to decode/parse:', err.message)
      return null
    }
  }
  const raw = trimEnvValue('FCM_SERVICE_ACCOUNT_JSON')
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

async function dispatchFcmDetailed(sub, payload) {
  requirePushPlatform('android')
  const accessToken = await getFcmAccessToken()
  const projectId = getFcmProjectId()
  if (!accessToken || !projectId) {
    return { success: false, status: null, reason: 'FCM access token unavailable' }
  }

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
      return { success: false, status: res.status, reason: txt.slice(0, 500) }
    }
    return { success: true, status: res.status, reason: null }
  } catch (err) {
    console.error('FCM dispatch error:', err)
    return { success: false, status: null, reason: err.message || 'FCM dispatch failed' }
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
  sendPushToUserWithStats,
  sendDiagnosticPushToUser,
  getPushValidationStatus,
  pushNotificationBadge,
  notifyNewFollower,
  notifyContributionUpvote,
  notifyContributionRemoved,
  notifyFollowRequestApproved,
  notifyPlannedVisit,
  getPlannedVisitsForToday
}
