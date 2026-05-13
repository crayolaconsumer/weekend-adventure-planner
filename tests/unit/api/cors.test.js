import { describe, it, expect, vi } from 'vitest'
import { applyCors, withCors, ALLOWED_ORIGINS } from '../../../api/lib/cors.js'

function mockReqRes({ method = 'GET', origin = null } = {}) {
  const headers = {}
  let statusCode = 200
  let ended = false
  return {
    req: { method, headers: { origin } },
    res: {
      setHeader: (key, value) => {
        headers[key] = value
      },
      getHeader: (key) => headers[key],
      headers,
      status: (code) => {
        statusCode = code
        return { end: () => { ended = true } }
      },
      get statusCode() { return statusCode },
      get ended() { return ended },
    },
  }
}

describe('applyCors', () => {
  it('echoes the production origin back', () => {
    const { req, res } = mockReqRes({ origin: 'https://www.go-roam.uk' })
    applyCors(req, res)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://www.go-roam.uk')
    expect(res.headers['Access-Control-Allow-Credentials']).toBe('true')
  })

  it('does not set Allow-Credentials for Capacitor origin', () => {
    const { req, res } = mockReqRes({ origin: 'capacitor://localhost' })
    applyCors(req, res)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('capacitor://localhost')
    expect(res.headers['Access-Control-Allow-Credentials']).toBeUndefined()
  })

  it('does not echo an unknown origin', () => {
    const { req, res } = mockReqRes({ origin: 'https://evil.example.com' })
    applyCors(req, res)
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('allows vercel preview deployments', () => {
    const { req, res } = mockReqRes({ origin: 'https://my-pr-foo.vercel.app' })
    applyCors(req, res)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://my-pr-foo.vercel.app')
  })

  it('sets Methods + Headers on every response', () => {
    const { req, res } = mockReqRes({ origin: 'https://www.go-roam.uk' })
    applyCors(req, res)
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(res.headers['Access-Control-Allow-Headers']).toContain('Authorization')
  })

  it('handles OPTIONS preflight with 204 and signals consumer to return', () => {
    const { req, res } = mockReqRes({ method: 'OPTIONS', origin: 'https://www.go-roam.uk' })
    const handled = applyCors(req, res)
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
  })

  it('returns false for non-OPTIONS so caller proceeds with the handler', () => {
    const { req, res } = mockReqRes({ method: 'POST', origin: 'https://www.go-roam.uk' })
    expect(applyCors(req, res)).toBe(false)
  })

  it('uses Max-Age=0 + Cache-Control:no-store for Capacitor origin', () => {
    const { req, res } = mockReqRes({ origin: 'capacitor://localhost' })
    applyCors(req, res)
    expect(res.headers['Access-Control-Max-Age']).toBe('0')
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('uses 24h preflight cache for web origin', () => {
    const { req, res } = mockReqRes({ origin: 'https://www.go-roam.uk' })
    applyCors(req, res)
    expect(res.headers['Access-Control-Max-Age']).toBe('86400')
    expect(res.headers['Cache-Control']).toBeUndefined()
  })
})

describe('withCors', () => {
  it('short-circuits on OPTIONS preflight without calling handler', async () => {
    const handler = vi.fn().mockResolvedValue('result')
    const wrapped = withCors(handler)
    const { req, res } = mockReqRes({ method: 'OPTIONS', origin: 'https://www.go-roam.uk' })
    await wrapped(req, res)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes non-OPTIONS through to the wrapped handler', async () => {
    const handler = vi.fn().mockResolvedValue('result')
    const wrapped = withCors(handler)
    const { req, res } = mockReqRes({ method: 'POST', origin: 'https://www.go-roam.uk' })
    await wrapped(req, res)
    expect(handler).toHaveBeenCalledWith(req, res)
  })
})

describe('ALLOWED_ORIGINS', () => {
  it('contains the expected origins', () => {
    expect(ALLOWED_ORIGINS.has('capacitor://localhost')).toBe(true)
    expect(ALLOWED_ORIGINS.has('https://localhost')).toBe(true)
    expect(ALLOWED_ORIGINS.has('https://go-roam.uk')).toBe(true)
    expect(ALLOWED_ORIGINS.has('https://www.go-roam.uk')).toBe(true)
  })
})
