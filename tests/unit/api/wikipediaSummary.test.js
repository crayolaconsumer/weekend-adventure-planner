import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../api/lib/rateLimit.js', () => ({
  applyRateLimit: () => null,
  applySharedRateLimit: async () => null,
  RATE_LIMITS: { API_GENERAL: {} },
}))
vi.mock('../../../api/lib/cors.js', () => ({ withCors: h => h }))

const { default: handler } = await import('../../../api/wikipedia/summary.js')

function call(tag) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, body }); return this },
    }
    handler({ method: 'GET', query: { tag }, headers: {} }, res)
  })
}

function upstream(body, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, json: async () => body })))
}

afterEach(() => vi.unstubAllGlobals())

// enrichPlace scores Wikipedia images by size; the proxy dropped the
// dimensions, so every Wikipedia photo scored as unknown size.
describe('GET /api/wikipedia/summary image dimensions', () => {
  it('returns the thumbnail width and height', async () => {
    upstream({ title: 'York Minster', extract: 'A cathedral.', thumbnail: { source: 'https://upload.wikimedia.org/t.jpg', width: 320, height: 240 }, originalimage: { source: 'https://upload.wikimedia.org/o.jpg', width: 4000, height: 3000 } })
    const { status, body } = await call('en:York Minster dims-a')
    expect(status).toBe(200)
    expect(body).toMatchObject({ thumbnail: 'https://upload.wikimedia.org/t.jpg', thumbnailWidth: 320, thumbnailHeight: 240 })
  })

  it('uses the original image dimensions when there is no thumbnail', async () => {
    upstream({ title: 'X', originalimage: { source: 'https://upload.wikimedia.org/o.jpg', width: 1600, height: 900 } })
    const { body } = await call('en:Original only dims-b')
    expect(body).toMatchObject({ thumbnail: 'https://upload.wikimedia.org/o.jpg', thumbnailWidth: 1600, thumbnailHeight: 900 })
  })

  it('passes the short description through, so the client can spot event articles', async () => {
    upstream({ title: 'September 11 attacks', description: 'Islamist terrorist attacks in the United States', extract: 'x' })
    const { body } = await call('en:September 11 attacks desc-a')
    expect(body.description).toBe('Islamist terrorist attacks in the United States')
  })

  it('returns null dimensions when there is no image', async () => {
    upstream({ title: 'Y', extract: 'No picture.' })
    const { body } = await call('en:No image dims-c')
    expect(body).toMatchObject({ thumbnail: null, thumbnailWidth: null, thumbnailHeight: null })
  })

  it('returns null dimensions for a missing article', async () => {
    upstream({}, 404)
    const { body } = await call('en:Missing dims-d')
    expect(body).toMatchObject({ thumbnail: null, thumbnailWidth: null, thumbnailHeight: null })
  })
})

// QA: two 502s for en:Hyde Park, London. Only transient upstream failures
// may be 502 (uncached); a permanent miss is a cacheable empty answer.
describe('GET /api/wikipedia/summary upstream errors', () => {
  it('treats a rejected title (400) as a cacheable miss, not a 502', async () => {
    upstream({}, 400)
    const { status, body } = await call('en:Bad|title miss-a')
    expect(status).toBe(200)
    expect(body).toMatchObject({ thumbnail: null, extract: null })
  })

  it.each([429, 503])('keeps %s as an uncached 502', async (code) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    upstream({}, code)
    const res = await new Promise(resolve => {
      const r = {
        statusCode: 200, headers: {},
        setHeader(k, v) { this.headers[k.toLowerCase()] = v },
        status(c) { this.statusCode = c; return this },
        json(body) { resolve({ status: this.statusCode, headers: this.headers, body }); return this },
      }
      handler({ method: 'GET', query: { tag: `en:Hyde Park, London ${code}` }, headers: {} }, r)
    })
    expect(res.status).toBe(502)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
