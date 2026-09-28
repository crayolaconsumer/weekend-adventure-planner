import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import process from 'node:process'

const sendEmail = vi.fn(async () => ({ sent: true }))
const kv = new Map()
vi.mock('../../../api/lib/email.js', () => ({ sendEmail: (...a) => sendEmail(...a) }))
vi.mock('../../../api/lib/kvCache.js', () => ({ cacheGet: async k => kv.get(k) ?? null, cacheSet: async (k, v) => { kv.set(k, v); return true } }))

let handler
beforeEach(async () => { vi.resetModules(); ({ default: handler } = await import('../../../api/cron/gh-dispatch.js')) })

async function run(workflow, auth = 'Bearer s3cret') {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  await handler({ method: 'GET', query: { workflow }, headers: { authorization: auth } }, res)
  return res
}

describe('cron gh-dispatch', () => {
  let fetchMock
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cret'
    process.env.GITHUB_DISPATCH_TOKEN = 'tok'
    kv.clear(); sendEmail.mockClear()
    fetchMock = vi.fn(async () => ({ status: 204, text: async () => '' }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GITHUB_DISPATCH_TOKEN })

  it.each([['synthetic', 'synthetic.yml'], ['poi-build', 'poi-build.yml']])('%s dispatches %s on main', async (name, file) => {
    const res = await run(name)
    expect(res.statusCode).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://api.github.com/repos/crayolaconsumer/weekend-adventure-planner/actions/workflows/${file}/dispatches`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ ref: 'main' })
  })

  it.each(['', 'loadtest', '../x', 'toString', '__proto__'])('refuses workflow %j without calling GitHub', async name => {
    expect((await run(name)).statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses unauthenticated calls', async () => {
    expect((await run('synthetic', 'Bearer nope')).statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed dispatch emails once per 6 h, not every 15 min, and never includes the token', async () => {
    fetchMock.mockImplementation(async () => ({ status: 403, text: async () => 'Resource not accessible by personal access token' }))
    expect((await run('synthetic')).statusCode).toBe(502)
    expect((await run('synthetic')).statusCode).toBe(502)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const mail = sendEmail.mock.calls[0][0]
    expect(mail.text).toContain('403')
    expect(JSON.stringify(mail)).not.toMatch(/Bearer/)
  })

  it('a malformed token (pasted with a newline) never reaches the log or the email', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'github_pat_SECRET\nPART2'
    // Node's fetch rejects the header and echoes its value (verified on Node 24)
    fetchMock.mockImplementation(async (_url, init) => { throw new TypeError(`Headers.append: "${init.headers.Authorization}" is an invalid header value.`) })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await run('synthetic')).statusCode).toBe(502)
    const out = JSON.stringify(sendEmail.mock.calls) + JSON.stringify(logged.mock.calls)
    expect(out).not.toContain('SECRET')
    expect(out).not.toContain('PART2')
    logged.mockRestore()
  })

  it('with KV down, a failing dispatch still emails only once per instance per 6 h', async () => {
    fetchMock.mockImplementation(async () => ({ status: 500, text: async () => '' }))
    kv.set = () => {} // cacheSet no-ops, cacheGet stays null
    try {
      for (let i = 0; i < 5; i++) await run('synthetic')
      expect(sendEmail).toHaveBeenCalledTimes(1)
    } finally { delete kv.set }
  })

  it('a missing token is reported, not thrown', async () => {
    delete process.env.GITHUB_DISPATCH_TOKEN
    expect((await run('poi-build')).statusCode).toBe(502)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('a network error is reported', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('ETIMEDOUT') })
    expect((await run('synthetic')).statusCode).toBe(502)
    expect(sendEmail.mock.calls[0][0].text).toContain('ETIMEDOUT')
  })
})
