import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Sign-up races and sign-up rate limits in api/auth/index.js.
// The fake users table enforces the same unique keys as prod
// (email, username, google_id, apple_id) and throws mysql2's ER_DUP_ENTRY.

let users
let dupErrors
let hideUsernames // simulate a racer whose row the username check can't see yet
let compares // hashes bcrypt.compare was asked to check

function dupError(key, value) {
  const err = new Error(`Duplicate entry '${value}' for key 'users.${key}'`)
  err.code = 'ER_DUP_ENTRY'
  err.errno = 1062
  return err
}

const tick = () => new Promise((r) => setTimeout(r, 0))

async function queryOne(sql, [value]) {
  await tick()
  const col = /WHERE (\w+) = \?/.exec(sql)[1]
  if (col === 'username' && hideUsernames) return null
  return users.find((u) => u[col] === value) || null
}

async function insert(sql, params) {
  await tick()
  const cols = /INSERT INTO users \(([^)]+)\)/.exec(sql)[1].split(',').map((c) => c.trim())
  const row = { id: users.length + 1 }
  cols.forEach((c, i) => { if (i < params.length) row[c] = params[i] })
  for (const key of ['email', 'username', 'google_id', 'apple_id']) {
    if (row[key] != null && users.some((u) => u[key] === row[key])) {
      dupErrors.push(key)
      throw dupError(key, row[key])
    }
  }
  users.push(row)
  return row.id
}

vi.mock('../../../api/lib/db.js', () => ({
  queryOne: (...a) => queryOne(...a),
  insert: (...a) => insert(...a),
  update: async () => 1,
  transaction: vi.fn(),
}))
vi.mock('bcryptjs', () => ({
  default: { hash: async (p) => `hash:${p}`, compare: async (p, h) => { compares.push(h); return h === `hash:${p}` } },
}))
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: { sub: 'apple-1', email: 'ann@privaterelay.appleid.com', email_verified: 'true' } }),
}))
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken() {
      return { getPayload: () => ({ sub: 'g-1', email: 'gina@example.com', email_verified: true, name: 'Gina' }) }
    }
  },
}))

let handler
beforeEach(async () => {
  vi.resetModules() // fresh in-memory rate-limit store per test
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client')
  vi.stubEnv('APPLE_SIGNIN_SERVICES_ID', 'com.goroam.app.signin')
  vi.stubEnv('JWT_SECRET', 'test-secret-test-secret-test-secret')
  users = []
  dupErrors = []
  hideUsernames = false
  compares = []
  handler = (await import('../../../api/auth/index.js')).default
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function run(body, ip = '100.64.0.1') {
  const out = { status: 200, body: null, headers: {} }
  const res = {
    setHeader: (k, v) => { out.headers[k] = v },
    getHeader: (k) => out.headers[k],
    status(code) { out.status = code; return this },
    json(b) { out.body = b; return this },
    end() { return this },
  }
  const req = { method: 'POST', headers: { 'x-forwarded-for': ip }, body }
  return handler(req, res).then(() => out)
}

const signUp = (email, extra = {}) => ({ action: 'register', email, password: 'Passw0rd!', ...extra })

describe('register double-submit', () => {
  it('two concurrent taps create one account; the second gets the email-in-use 400, never a 500', async () => {
    const [a, b] = await Promise.all([run(signUp('sam@example.com')), run(signUp('sam@example.com'))])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 400])
    expect(users.filter((u) => u.email === 'sam@example.com')).toHaveLength(1)
    // Both passed the pre-check, so the race went through the INSERT's unique key
    expect(dupErrors).toContain('email')
    const loser = a.status === 400 ? a : b
    expect(loser.body.error).toBe('Unable to create account. Please try signing in instead.')
  })

  it('a sequential retry of the same sign-up gets the same 400', async () => {
    expect((await run(signUp('sam@example.com'))).status).toBe(201)
    const again = await run(signUp('Sam@Example.com'))
    expect(again.status).toBe(400)
    expect(users).toHaveLength(1)
  })
})

describe('generated username collisions', () => {
  it('retries with a new suffix when a concurrent sign-up took the name', async () => {
    users.push({ id: 1, email: 'alex@other.com', username: 'alex' })
    hideUsernames = true // the availability check misses the racer's row
    const out = await run(signUp('alex@example.com'))
    expect(out.status).toBe(201)
    expect(dupErrors[0]).toBe('username')
    expect(out.body.user.username).toMatch(/^alex\d+$/)
    expect(users).toHaveLength(2)
  })

  it('gives up after 5 retries instead of looping forever', async () => {
    const { insertWithUniqueUsername } = await import('../../../api/lib/auth.js')
    let calls = 0
    const always = async () => { calls++; throw dupError('username', 'x') }
    await expect(insertWithUniqueUsername('x@example.com', always)).rejects.toThrow(/Duplicate entry/)
    expect(calls).toBe(6) // first try + 5 retries
  })

  it('does not swallow other errors', async () => {
    const { insertWithUniqueUsername } = await import('../../../api/lib/auth.js')
    let calls = 0
    const boom = async () => { calls++; throw new Error('connection lost') }
    await expect(insertWithUniqueUsername('x@example.com', boom)).rejects.toThrow('connection lost')
    expect(calls).toBe(1)
  })
})

describe('duplicateKey', () => {
  it('reads the key name from MySQL 8 and 5.7 messages', async () => {
    const { duplicateKey } = await import('../../../api/lib/auth.js')
    expect(duplicateKey(dupError('email', "o'brien@x.com"))).toBe('email')
    const old = new Error("Duplicate entry 'bob' for key 'username'")
    old.code = 'ER_DUP_ENTRY'
    expect(duplicateKey(old)).toBe('username')
    expect(duplicateKey(new Error('nope'))).toBe(null)
    expect(duplicateKey(null)).toBe(null)
  })
})

describe('OAuth first sign-in is idempotent', () => {
  it('two concurrent Google first sign-ins return the same user', async () => {
    const [a, b] = await Promise.all([
      run({ action: 'google', credential: 'id.token' }),
      run({ action: 'google', credential: 'id.token' }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(users).toHaveLength(1)
    expect(a.body.user.id).toBe(b.body.user.id)
    expect(dupErrors.length).toBeGreaterThan(0)
  })

  it('two concurrent Apple first sign-ins return the same user', async () => {
    const [a, b] = await Promise.all([
      run({ action: 'apple', identityToken: 'x.y.z' }),
      run({ action: 'apple', identityToken: 'x.y.z' }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(users).toHaveLength(1)
    expect(a.body.user.id).toBe(b.body.user.id)
  })
})

describe('sign-up limits under carrier NAT', () => {
  it('20 sign-ups with distinct emails from one IP all succeed', async () => {
    const results = []
    for (let i = 0; i < 20; i++) results.push(await run(signUp(`phone${i}@example.com`)))
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201))
  })

  it('repeated attempts on one email are limited, whatever the IP', async () => {
    const statuses = []
    for (let i = 0; i < 5; i++) statuses.push((await run(signUp('spam@example.com'), `10.0.0.${i}`)).status)
    // 1 created, 2 refused as in-use, then the per-email cap (3/hour) kicks in
    expect(statuses).toEqual([201, 400, 400, 429, 429])
  })

  it('invalid attempts do not burn the per-email allowance', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await run({ action: 'register', email: 'fix@example.com', password: 'weak' })).status).toBe(400)
    }
    expect((await run(signUp('fix@example.com'))).status).toBe(201)
  })
})

describe('login brute force', () => {
  const login = (password, ip) => run({ action: 'login', email: 'vic@example.com', password }, ip)
  beforeEach(() => {
    users.push({ id: 1, email: 'vic@example.com', username: 'vic', password_hash: 'hash:Right1234' })
  })

  it('caps guesses on one account from one IP, but the owner on another IP is not locked out', async () => {
    const statuses = []
    for (let i = 0; i < 12; i++) statuses.push((await login('Wrong1234', '10.1.0.1')).status)
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401))
    expect(statuses.slice(10)).toEqual([429, 429])
    expect((await login('Right1234', '10.2.0.1')).status).toBe(200)
  })

  it('a successful login clears that IP\'s failure count', async () => {
    for (let i = 0; i < 9; i++) expect((await login('Wrong1234', '10.1.0.1')).status).toBe(401)
    expect((await login('Right1234', '10.1.0.1')).status).toBe(200)
    for (let i = 0; i < 10; i++) expect((await login('Wrong1234', '10.1.0.1')).status).toBe(401)
    expect((await login('Wrong1234', '10.1.0.1')).status).toBe(429)
  })

  it('an unknown email still pays for a bcrypt compare (no timing oracle)', async () => {
    const out = await run({ action: 'login', email: 'nobody@example.com', password: 'Whatever1' })
    expect(out.status).toBe(401)
    expect(compares).toHaveLength(1)
    expect(compares[0]).toMatch(/^\$2[aby]\$10\$.{53}$/)
  })

  it('many accounts behind one IP can still log in', async () => {
    for (let i = 0; i < 20; i++) users.push({ id: i + 1, email: `u${i}@example.com`, username: `u${i}`, password_hash: 'hash:Right1234' })
    for (let i = 0; i < 20; i++) {
      expect((await run({ action: 'login', email: `u${i}@example.com`, password: 'Right1234' })).status).toBe(200)
    }
  })
})
