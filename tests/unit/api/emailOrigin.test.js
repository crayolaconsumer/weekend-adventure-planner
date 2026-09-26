import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendEmail } from '../../../api/lib/email.js'
import { appOrigin } from '../../../api/lib/origin.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs() })

describe('sendEmail (regression: the resend SDK was never installed, so no email ever sent)', () => {
  it('posts to the Resend API', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => '' }))
    expect(await sendEmail({ to: 'a@b.c', subject: 'Hi', text: 'x' })).toEqual({ sent: true, provider: 'resend' })
    const [url, opts] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(opts.headers.Authorization).toBe('Bearer re_test')
    expect(JSON.parse(opts.body)).toMatchObject({ from: 'ROAM <noreply@go-roam.uk>', to: 'a@b.c', subject: 'Hi' })
  })

  it('reports a failed send as not sent (it used to claim success)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, text: async () => 'bad from' }))
    const out = await sendEmail({ to: 'a@b.c', subject: 'Hi', text: 'x' })
    expect(out.sent).toBe(false)
    expect(out.error).toMatch(/422/)
  })
})

describe('appOrigin (regression: crons called the SSO-protected *.vercel.app host and got 401)', () => {
  const req = { headers: { host: 'weekend-adventure-planner-abc.vercel.app', 'x-forwarded-proto': 'https' } }
  it('uses the public domain in production', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(appOrigin(req)).toBe('https://www.go-roam.uk')
  })
  it('uses the request host elsewhere (previews, local)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(appOrigin(req)).toBe('https://weekend-adventure-planner-abc.vercel.app')
  })
})
