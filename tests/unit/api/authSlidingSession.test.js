import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'

// GET /api/auth renews tokens older than a day, so active users are never
// signed out by the 30-day JWT expiry (regression: "it keeps signing people out").

const SECRET = 'test-secret-test-secret-test-secret'
const USER = { id: 7, email: 'a@b.co', username: 'sam', is_admin: 0, is_banned: 0 }
const queryOne = vi.fn(async () => ({ ...USER }))

vi.mock('../../../api/lib/db.js', () => ({
  queryOne: (...a) => queryOne(...a),
  update: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))

let handler
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('JWT_SECRET', SECRET)
  handler = (await import('../../../api/auth/index.js')).default
})
afterEach(() => vi.unstubAllEnvs())

const tokenAged = (seconds) => jwt.sign(
  { userId: USER.id, email: USER.email, username: USER.username, iat: Math.floor(Date.now() / 1000) - seconds },
  SECRET, { expiresIn: '30d' }
)

function getMe(headers) {
  const out = { status: 200, body: null, headers: {} }
  const res = {
    setHeader: (k, v) => { out.headers[k] = v },
    getHeader: (k) => out.headers[k],
    status(code) { out.status = code; return this },
    json(b) { out.body = b; return this },
    end() { return this },
  }
  return handler({ method: 'GET', query: {}, headers: { 'x-forwarded-for': '1.2.3.4', ...headers } }, res).then(() => out)
}

describe('sliding session on GET /api/auth', () => {
  it('returns a fresh token when the current one is older than a day', async () => {
    const out = await getMe({ authorization: `Bearer ${tokenAged(2 * 86400)}` })
    expect(out.status).toBe(200)
    expect(out.body.user.id).toBe(USER.id)
    const fresh = jwt.verify(out.body.token, SECRET)
    expect(fresh.userId).toBe(USER.id)
    expect(Date.now() / 1000 - fresh.iat).toBeLessThan(60)
  })

  it('does not reissue a token that is still fresh', async () => {
    const out = await getMe({ authorization: `Bearer ${tokenAged(600)}` })
    expect(out.status).toBe(200)
    expect(out.body.token).toBeUndefined()
  })

  it('refreshes the web cookie too, and only when the request used one', async () => {
    const web = await getMe({ cookie: `roam_token=${tokenAged(3 * 86400)}`, origin: 'https://www.go-roam.uk' })
    expect(String(web.headers['Set-Cookie'])).toMatch(/^roam_token=/)
    const app = await getMe({ authorization: `Bearer ${tokenAged(3 * 86400)}`, origin: 'capacitor://localhost' })
    expect(app.headers['Set-Cookie']).toBeUndefined()
  })

  it('still rejects expired or missing tokens', async () => {
    expect((await getMe({})).status).toBe(401)
  })
})

describe('renewed web cookie keeps the chosen lifetime', () => {
  it('stays short when "Keep me signed in" was off, long when on', async () => {
    const short = await getMe({ cookie: `roam_token=${tokenAged(3 * 86400)}`, origin: 'https://www.go-roam.uk', 'x-roam-remember': '0' })
    expect(String(short.headers['Set-Cookie'])).toMatch(/Max-Age=604800/)
    const long = await getMe({ cookie: `roam_token=${tokenAged(3 * 86400)}`, origin: 'https://www.go-roam.uk', 'x-roam-remember': '1' })
    expect(String(long.headers['Set-Cookie'])).toMatch(/Max-Age=2592000/)
  })

  it('a cookie-only session with no header stays short, never upgraded to 30 days', async () => {
    const out = await getMe({ cookie: `roam_token=${tokenAged(3 * 86400)}`, origin: 'https://www.go-roam.uk' })
    expect(String(out.headers['Set-Cookie'])).toMatch(/Max-Age=604800/)
  })

  it('allows the X-Roam-Remember header cross-origin, so the native app auth check is not blocked by CORS', async () => {
    const src = await import('node:fs').then(fs => fs.readFileSync('api/lib/cors.js', 'utf8'))
    expect(src).toMatch(/ALLOWED_HEADERS = '[^']*X-Roam-Remember/)
  })
})
