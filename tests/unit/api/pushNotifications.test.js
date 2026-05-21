import { Buffer } from 'node:buffer'
import { describe, it, expect } from 'vitest'
import { validatePushEnvironment } from '../../../api/lib/pushNotifications.js'

const validFcm = Buffer.from(JSON.stringify({
  client_email: 'firebase@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  project_id: 'roam-test'
})).toString('base64')

function validEnv() {
  return {
    VAPID_PUBLIC_KEY: 'A'.repeat(87),
    VAPID_PRIVATE_KEY: 'B'.repeat(43),
    VAPID_SUBJECT: 'mailto:hello@go-roam.uk',
    APNS_KEY_ID: 'RB7BPM9J29',
    APNS_TEAM_ID: 'TEAMID1234',
    APNS_BUNDLE_ID: 'com.goroam.app',
    APNS_AUTH_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    FCM_SERVICE_ACCOUNT_JSON_B64: validFcm
  }
}

describe('validatePushEnvironment', () => {
  it('accepts valid push credentials', () => {
    const status = validatePushEnvironment(validEnv())
    expect(status.validation).toEqual({ vapid: 'ok', apns: 'ok', fcm: 'ok' })
  })

  it('trims env values before validating and can write trimmed values back', () => {
    const env = validEnv()
    env.APNS_KEY_ID = 'RB7BPM9J29\n'
    env.VAPID_PRIVATE_KEY = `  ${env.VAPID_PRIVATE_KEY}  `

    const status = validatePushEnvironment(env, { applyTrim: true })

    expect(status.validation.apns).toBe('ok')
    expect(status.validation.vapid).toBe('ok')
    expect(env.APNS_KEY_ID).toBe('RB7BPM9J29')
    expect(env.VAPID_PRIVATE_KEY).toBe('B'.repeat(43))
  })

  it('reports platform-specific credential failures', () => {
    const env = validEnv()
    env.VAPID_PUBLIC_KEY = 'not-valid'
    env.APNS_TEAM_ID = 'TEAMID123'
    env.FCM_SERVICE_ACCOUNT_JSON_B64 = Buffer.from(JSON.stringify({ project_id: 'only-project' })).toString('base64')

    const status = validatePushEnvironment(env)

    expect(status.validation).toEqual({ vapid: 'error', apns: 'error', fcm: 'error' })
    expect(status.errors.vapid[0]).toContain('VAPID_PUBLIC_KEY')
    expect(status.errors.apns[0]).toContain('APNS_TEAM_ID')
    expect(status.errors.fcm).toContain('FCM service account JSON missing client_email')
  })
})
