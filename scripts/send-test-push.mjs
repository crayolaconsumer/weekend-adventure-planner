/**
 * Final end-to-end push test using the production sendPushToUser code path.
 *
 * Sets NODE_ENV=production to mimic Vercel runtime (so APNS uses
 * api.push.apple.com), loads the FCM service account JSON from disk
 * to bypass Node's --env-file mangling of multi-line JSON.
 */

import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Force production APNS endpoint (matches Vercel runtime behaviour)
process.env.NODE_ENV = 'production'

// Load FCM creds from the JSON file on disk — bypass any env-file weirdness
const fcmPath = join(homedir(), '.appstoreconnect/private_keys/roam-firebase-service-account.json')
if (existsSync(fcmPath)) {
  process.env.FCM_SERVICE_ACCOUNT_JSON = readFileSync(fcmPath, 'utf8')
}

const { sendPushToUserWithStats } = await import('../api/lib/pushNotifications.js')

const userIds = process.argv.slice(2).map(s => parseInt(s, 10)).filter(Number.isFinite)
if (userIds.length === 0) {
  console.error('Usage: node --env-file=.env scripts/send-test-push.mjs <userId1> [userId2] ...')
  process.exit(1)
}

for (const userId of userIds) {
  console.log(`\nDispatching to user_id=${userId} via sendPushToUserWithStats...`)
  try {
    const result = await sendPushToUserWithStats(userId, {
      title: 'ROAM end-to-end test',
      body: 'If you see this, push delivery is wired up for your platform.',
      url: '/',
      tag: 'final-test-' + Date.now()
    })
    console.log(`  ${result.success ? 'SUCCESS' : 'FAILED'} - subscriptions=${result.subscriptionCount}`)
    console.log(`  perPlatform=${JSON.stringify(result.perPlatform)}`)
    for (const delivery of result.results) {
      console.log(`  ${delivery.platform}#${delivery.id}: ${delivery.success ? 'ok' : 'failed'} status=${delivery.status || 'n/a'} reason=${delivery.reason || 'n/a'} env=${delivery.env || 'n/a'}`)
    }
  } catch (err) {
    console.log(`  THREW: ${err.message}`)
  }
  // Brief gap between sends so the user can clearly see two notifications
  await new Promise(r => setTimeout(r, 2000))
}

process.exit(0)
