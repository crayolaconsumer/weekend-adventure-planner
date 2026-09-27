import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Google access-token audience check + social account-linking hardening in
// api/auth/index.js (pre-hijack of email/password accounts).

const queryOne = vi.fn()
const update = vi.fn(async () => 1)
const insert = vi.fn(async () => 99)
const jwtVerify = vi.fn()
const verifyIdToken = vi.fn()

vi.mock('../../../api/lib/db.js', () => ({
  queryOne: (...a) => queryOne(...a),
  update: (...a) => update(...a),
  insert: (...a) => insert(...a),
  transaction: vi.fn(),
}))
vi.mock('../../../api/lib/rateLimit.js', () => ({
  applyRateLimit: () => null,
  checkRateLimit: () => ({ allowed: true }),
  RATE_LIMITS: {},
}))
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: (...a) => jwtVerify(...a),
}))
vi.mock('google-auth-library', () => ({
  OAuth2Client: class { verifyIdToken(...a) { return verifyIdToken(...a) } },
}))

const OUR_CLIENT = 'our-client.apps.googleusercontent.com'
const STATE = 'a'.repeat(32)

let handler
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('GOOGLE_CLIENT_ID', OUR_CLIENT)
  vi.stubEnv('APPLE_SIGNIN_SERVICES_ID', 'com.goroam.app.signin')
  vi.stubEnv('JWT_SECRET', 'test-secret-test-secret-test-secret')
  queryOne.mockReset()
  update.mockClear()
  insert.mockClear()
  jwtVerify.mockReset()
  verifyIdToken.mockReset()
  handler = (await import('../../../api/auth/index.js')).default
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function run(body) {
  const out = { status: 200, body: null, headers: {} }
  const res = {
    setHeader: (k, v) => { out.headers[k] = v },
    getHeader: (k) => out.headers[k],
    status(code) { out.status = code; return this },
    json(b) { out.body = b; return this },
    end() { return this },
  }
  const req = { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4' }, body }
  return handler(req, res).then(() => out)
}

function stubGoogleFetch({ tokenInfo, userInfo }) {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      return { ok: !!tokenInfo, json: async () => tokenInfo }
    }
    return { ok: true, json: async () => userInfo }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const googleUser = { sub: 'g-1', email: 'victim@example.com', email_verified: true, name: 'Vic' }
const accessBody = { action: 'google', accessToken: 'ya29.token', oauthState: STATE, oauthStateCheck: STATE }
const linkedRow = { id: 7, email: 'victim@example.com', username: 'vic', email_verified: true, tier: 'free' }

describe('Google access-token login audience', () => {
  it('rejects a token issued to another Google client', async () => {
    stubGoogleFetch({ tokenInfo: { sub: 'g-1', aud: 'someone-else', azp: 'someone-else' }, userInfo: googleUser })
    const out = await run(accessBody)
    expect(out.status).toBe(401)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('rejects when tokeninfo says the token is invalid', async () => {
    stubGoogleFetch({ tokenInfo: null, userInfo: googleUser })
    const out = await run(accessBody)
    expect(out.status).toBe(401)
  })

  it('rejects when userinfo subject differs from the token subject', async () => {
    stubGoogleFetch({ tokenInfo: { sub: 'g-2', aud: OUR_CLIENT }, userInfo: googleUser })
    const out = await run(accessBody)
    expect(out.status).toBe(401)
  })

  it('accepts a token issued to our client', async () => {
    const f = stubGoogleFetch({ tokenInfo: { sub: 'g-1', aud: OUR_CLIENT, azp: OUR_CLIENT }, userInfo: googleUser })
    queryOne.mockResolvedValueOnce({ ...linkedRow, google_id: 'g-1', last_login_at: new Date() })
    const out = await run(accessBody)
    expect(out.status).toBe(200)
    expect(String(f.mock.calls[0][0])).toContain('access_token=ya29.token')
  })

  it('ID-token path still verifies against our client ID', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => googleUser })
    queryOne.mockResolvedValueOnce({ ...linkedRow, google_id: 'g-1', last_login_at: new Date() })
    const out = await run({ action: 'google', credential: 'id.token' })
    expect(out.status).toBe(200)
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'id.token', audience: OUR_CLIENT })
  })
})

const preRegistered = { id: 7, email: 'victim@example.com', password_hash: '$2b$attacker', email_verified: 0, google_id: null, apple_id: null }

function passwordCleared() {
  // Clearing the password must also revoke existing sessions (token_version bump)
  return update.mock.calls.some(([sql, params]) => /password_hash = NULL/.test(sql) && /token_version = token_version \+ 1/.test(sql) && params[0] === 7)
}

describe('Google linking to an existing email account', () => {
  beforeEach(() => {
    stubGoogleFetch({ tokenInfo: { sub: 'g-1', aud: OUR_CLIENT }, userInfo: googleUser })
  })

  it('clears a pre-registered, never-verified password when linking', async () => {
    queryOne
      .mockResolvedValueOnce(null) // by google_id
      .mockResolvedValueOnce(preRegistered) // by email
      .mockResolvedValueOnce(linkedRow) // reload
    const out = await run(accessBody)
    expect(out.status).toBe(200)
    expect(passwordCleared()).toBe(true)
  })

  it('keeps the password when the account was already verified', async () => {
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...preRegistered, email_verified: 1, apple_id: 'a-1' })
      .mockResolvedValueOnce(linkedRow)
    const out = await run(accessBody)
    expect(out.status).toBe(200)
    expect(passwordCleared()).toBe(false)
  })

  it('refuses to link when Google says the email is not verified', async () => {
    stubGoogleFetch({ tokenInfo: { sub: 'g-1', aud: OUR_CLIENT }, userInfo: { ...googleUser, email_verified: false } })
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(preRegistered)
    const out = await run(accessBody)
    expect(out.status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('Apple linking to an existing email account', () => {
  it('clears a pre-registered, never-verified password when linking', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: 'a-1', email: 'victim@example.com', email_verified: 'true' } })
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(preRegistered)
      .mockResolvedValueOnce(linkedRow)
    const out = await run({ action: 'apple', identityToken: 'x.y.z' })
    expect(out.status).toBe(200)
    expect(passwordCleared()).toBe(true)
  })

  it('refuses to link an unverified Apple email', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: 'a-1', email: 'victim@example.com', email_verified: false } })
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(preRegistered)
    const out = await run({ action: 'apple', identityToken: 'x.y.z' })
    expect(out.status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })
})
