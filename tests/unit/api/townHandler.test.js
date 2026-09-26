import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHandler, callOverpassProxy, parseNear } from '../../../api/town.js'

// Tests don't wait for the real 1 req/s Nominatim gate (covered in towns.test.js)
const gate = async () => {}

const HATFIELD = { name: 'Hatfield', lat: '51.7635', lon: '-0.2259', address: { town: 'Hatfield', county: 'Hertfordshire', country: 'United Kingdom', country_code: 'gb' } }
const PLACES = { elements: [
  { type: 'node', id: 101, lat: 51.76, lon: -0.22, tags: { name: 'Hatfield House', tourism: 'attraction', wikidata: 'Q1' } },
  { type: 'way', id: 102, center: { lat: 51.76, lon: -0.23 }, tags: { name: 'Hatfield Park', leisure: 'park' } }
] }

const jsonResponse = body => ({ ok: true, status: 200, json: async () => body })

// Fake Nominatim: search by q, reverse always lands in Hatfield
function nominatim({ down = false } = {}) {
  return vi.fn(async url => {
    if (down) return { ok: false, status: 503 }
    if (url.includes('/reverse')) return jsonResponse({ address: { city: 'Welwyn Hatfield', town: 'Hatfield', county: 'Hertfordshire' } })
    const q = decodeURIComponent(url.match(/q=([^&]*)/)[1])
    if (q === 'hatfield' || q === 'hatfeild') return jsonResponse([HATFIELD])
    return jsonResponse([])
  })
}

// Stand-in for api/places/overpass/nearby.js with the same (req, res) contract
function proxy({ status = 200, body = PLACES } = {}) {
  return vi.fn(async (req, res) => res.status(status).json(body))
}

let ipCounter = 0
function run(handler, query, headers = {}) {
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(c) { this.statusCode = c; return this },
    send(b) { this.body = b; return this },
    json(b) { this.body = b; return this },
    end() { return this }
  }
  // Fresh IP per request so the per-IP rate limit never interferes
  const req = { method: 'GET', query, headers: { 'x-forwarded-for': `10.0.${ipCounter >> 8}.${ipCounter++ & 255}`, ...headers } }
  return Promise.resolve(handler(req, res)).then(() => res)
}

describe('api/town — web pages', () => {
  let fetchImpl, px, handler
  beforeEach(() => {
    fetchImpl = nominatim()
    px = proxy()
    handler = createHandler({ proxy: px, fetchImpl, gate })
  })

  it('renders any town live, with places from the proxy', async () => {
    const res = await run(handler, { slug: 'hatfield' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['cache-control']).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
    expect(res.body).toContain('<h1>Hatfield</h1>')
    expect(res.body).toContain('href="/place/101"')
    expect(res.body).toContain('href="/place/w102"')
    expect(res.body).toContain('Hatfield Park')
    // proxy got a real bbox around the geocoded (not hardcoded) position
    const query = px.mock.calls[0][0].body.query
    expect(query).toContain('[bbox:51.7335,-0.2649,51.7935,-0.1869]')
  })

  it('passes the visitor IP to the proxy so its per-IP rate limit still applies', async () => {
    await run(handler, { slug: 'hatfield' }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })
    expect(px.mock.calls[0][0].headers['x-forwarded-for']).toBe('203.0.113.9')
  })

  it('still renders when Overpass is down, but never caches that moment publicly', async () => {
    handler = createHandler({ proxy: proxy({ status: 503, body: { error: 'down' } }), fetchImpl, gate })
    const res = await run(handler, { slug: 'hatfield' })
    expect(res.statusCode).toBe(200)
    // regression: one rate-limited visitor's empty page was shared via the CDN
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toContain('noindex')
    expect(res.body).toContain('App Store')
  })

  it('301s non-canonical slugs', async () => {
    const res = await run(handler, { slug: 'Hatfield' })
    expect(res.statusCode).toBe(301)
    expect(res.headers.location).toBe('/town/hatfield')
  })

  it('301s typos to the real town', async () => {
    const res = await run(handler, { slug: 'hatfeild' })
    expect(res.statusCode).toBe(301)
    expect(res.headers.location).toBe('/town/hatfield')
  })

  it('404s unknown towns with a search box, without calling the proxy', async () => {
    const res = await run(handler, { slug: 'asdfqwer' })
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('No town by that name')
    expect(res.body).toContain('noindex')
    expect(px).not.toHaveBeenCalled()
  })

  it('404s junk slugs without touching the geocoder', async () => {
    const res = await run(handler, { slug: 'a-b-c-d-e-f-g-h' })
    expect(res.statusCode).toBe(404)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('503s (uncached, noindex, says so) when the geocoder is down', async () => {
    handler = createHandler({ proxy: px, fetchImpl: nominatim({ down: true }), gate })
    const res = await run(handler, { slug: 'hatfield' })
    expect(res.statusCode).toBe(503)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toContain('Town search is busy')
    expect(res.body).toContain('noindex')
  })

  it('an all-empty Overpass answer is a degraded mirror, not an empty town: never cached (regression)', async () => {
    handler = createHandler({ proxy: proxy({ body: { elements: [], remark: 'runtime error: Query timed out' } }), fetchImpl, gate })
    const res = await run(handler, { slug: 'hatfield' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('redirects in one hop to the final URL (regression: Saint-Albans → saint-albans → st-albans)', async () => {
    const STA = { name: 'St Albans', lat: '51.7531', lon: '-0.338', address: {} }
    const f = vi.fn(async url => /q=(saint%20albans|st%20albans)&/.test(url) ? jsonResponse([STA]) : jsonResponse([]))
    const h = createHandler({ proxy: proxy(), fetchImpl: f, gate })
    const res = await run(h, { slug: 'Saint-Albans' })
    expect(res.statusCode).toBe(301)
    expect(res.headers.location).toBe('/town/st-albans')
    const final = await run(h, { slug: 'st-albans' })
    expect(final.statusCode).toBe(200)
  })

  it('falls back to the requested URL if the canonical check fails, instead of 503', async () => {
    let calls = 0
    const f = vi.fn(async () => (++calls === 1 ? jsonResponse([{ name: 'St Albans', lat: '51.75', lon: '-0.34', address: {} }]) : { ok: false, status: 503 }))
    const h = createHandler({ proxy: proxy(), fetchImpl: f, gate })
    const res = await run(h, { slug: 'saint-albans' })
    expect(res.statusCode).toBe(200)
  })

  it('does not put one visitor\'s rate-limit headers in the shared CDN copy', async () => {
    const removed = []
    const res = await run(handler, { slug: 'hatfield' })
    // run() mock has no removeHeader; exercise it directly
    const r = { h: {}, setHeader(k, v) { this.h[k] = v }, removeHeader(k) { removed.push(k); delete this.h[k] }, status() { return this }, send() { return this } }
    await handler({ method: 'GET', query: { slug: 'hatfield' }, headers: { 'x-forwarded-for': '192.0.2.77' } }, r)
    expect(res.statusCode).toBe(200)
    expect(removed).toEqual(expect.arrayContaining(['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']))
    expect(r.h['X-RateLimit-Remaining']).toBeUndefined()
  })

  it('never redirect-loops between two aliases (critic probe: aa → "Bb", bb → "Aa")', async () => {
    const at = (name, lat) => ({ ok: true, status: 200, json: async () => [{ name, lat: String(lat), lon: '0', address: {} }] })
    for (const [latA, latB] of [[10, 20], [10, 10]]) { // different places, then the same place
      const f = vi.fn(async url => url.includes('q=aa') ? at('Bb', latA) : at('Aa', latB))
      const h = createHandler({ proxy: proxy(), fetchImpl: f, gate })
      const a = await run(h, { slug: 'aa' })
      const b = await run(h, { slug: 'bb' })
      expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    }
  })

  it('HTML visitors who hit the rate limit get a page, not raw JSON', async () => {
    let res
    for (let i = 0; i < 61; i++) res = await run(handler, { slug: 'hatfield' }, { 'x-forwarded-for': '192.0.2.200' })
    expect(res.statusCode).toBe(429)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('/town is the hub', async () => {
    const res = await run(handler, {})
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Explore a town')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('/town?q= redirects search to the slug', async () => {
    const res = await run(handler, { q: 'Houghton Regis' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/town/houghton-regis')
    const bad = await run(handler, { q: '!!!' })
    expect(bad.headers.location).toBe('/town')
  })

  it('/town?q= goes to the final URL in one hop (regression: 302 then 301)', async () => {
    const res = await run(handler, { q: 'Hatfeild' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/town/hatfield')
  })

  it('search JSON for the app returns the final slug, or 404', async () => {
    const hit = await run(handler, { q: 'Hatfeild', format: 'json' })
    expect(hit.statusCode).toBe(200)
    expect(hit.body).toEqual({ slug: 'hatfield' })
    const miss = await run(handler, { q: 'asdfqwer', format: 'json' })
    expect(miss.statusCode).toBe(404)
  })

  it('near-me has its own tighter per-IP limit (it costs up to 4 geocoder calls)', async () => {
    let res
    for (let i = 0; i < 11; i++) res = await run(handler, { near: '51.764,-0.226', format: 'json' }, { 'x-forwarded-for': '192.0.2.201' })
    expect(res.statusCode).toBe(429)
    // named towns from the same IP still work
    const named = await run(handler, { slug: 'hatfield', format: 'json' }, { 'x-forwarded-for': '192.0.2.201' })
    expect(named.statusCode).toBe(200)
  })

  it('near-me lands on the canonical URL in one hop', async () => {
    const f = vi.fn(async url => url.includes('/reverse')
      ? jsonResponse({ address: { city: 'City of Westminster', county: 'London' } })
      : url.includes('q=city%20of%20westminster&') || url.includes('q=westminster&')
        ? jsonResponse([{ name: 'Westminster', lat: '51.4975', lon: '-0.1357', address: {} }])
        : jsonResponse([]))
    const h = createHandler({ proxy: proxy(), fetchImpl: f, gate })
    const res = await run(h, { slug: 'near-me' }, { 'x-vercel-ip-latitude': '51.4975', 'x-vercel-ip-longitude': '-0.1357' })
    expect(res.headers.location).toBe('/town/westminster')
  })

  it('/town/near-me redirects to the visitor\'s town using Vercel IP geolocation', async () => {
    const res = await run(handler, { slug: 'near-me' }, { 'x-vercel-ip-latitude': '51.764', 'x-vercel-ip-longitude': '-0.226' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/town/hatfield')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('/town/near-me without geolocation falls back to the hub', async () => {
    const res = await run(handler, { slug: 'near-me' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/town')
  })

  it('rejects non-GET', async () => {
    const post = { method: 'POST', query: {}, headers: {} }
    const r = { statusCode: 0, setHeader() {}, status(c) { this.statusCode = c; return this }, json() { return this } }
    await handler(post, r)
    expect(r.statusCode).toBe(405)
  })
})

describe('api/town — app JSON', () => {
  const handler = createHandler({ proxy: proxy(), fetchImpl: nominatim(), gate })

  it('returns the town with CORS for capacitor origins', async () => {
    const res = await run(handler, { slug: 'hatfield', format: 'json' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.body.town).toMatchObject({ slug: 'hatfield', name: 'Hatfield', region: 'Hertfordshire' })
  })

  it('public JSON carries no per-visitor rate-limit headers (regression)', async () => {
    const removed = []
    const r = { h: {}, setHeader(k, v) { this.h[k] = v }, removeHeader(k) { removed.push(k); delete this.h[k] }, status() { return this }, json() { return this } }
    await handler({ method: 'GET', query: { slug: 'hatfield', format: 'json' }, headers: { 'x-forwarded-for': '192.0.2.78' } }, r)
    expect(r.h['Cache-Control']).toMatch(/^public/)
    expect(r.h['X-RateLimit-Remaining']).toBeUndefined()
  })

  it('returns the canonical slug for typos instead of redirecting', async () => {
    const res = await run(handler, { slug: 'hatfeild', format: 'json' })
    expect(res.statusCode).toBe(200)
    expect(res.body.town.slug).toBe('hatfield')
  })

  it('resolves device GPS via near=', async () => {
    const res = await run(handler, { near: '51.764,-0.226', format: 'json' })
    expect(res.statusCode).toBe(200)
    expect(res.body.town.slug).toBe('hatfield')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('validates coordinates', async () => {
    for (const near of ['abc', '91,0', '0,181', '']) {
      const res = await run(handler, { near, format: 'json' })
      expect(res.statusCode).toBe(400)
    }
  })

  it('404s unknown towns', async () => {
    const res = await run(handler, { slug: 'asdfqwer', format: 'json' })
    expect(res.statusCode).toBe(404)
  })
})

describe('parseNear', () => {
  it('accepts real coordinates only (regression: "," parsed as 0,0)', () => {
    expect(parseNear('51.764,-0.226')).toEqual({ lat: 51.764, lng: -0.226 })
    expect(parseNear('0,0')).toEqual({ lat: 0, lng: 0 })
    for (const bad of [',', '', '1,', ',1', '1e1,2', ' 1,2', '91,0', '0,181', 'undefined,undefined', null]) {
      expect(parseNear(bad)).toBe(null)
    }
  })
})

describe('callOverpassProxy', () => {
  it('gives up at the time budget instead of outliving the function (regression: 504 at 60s)', async () => {
    const hang = () => new Promise(() => {})
    const started = Date.now()
    const out = await callOverpassProxy('q', 'ip', hang, 30)
    expect(out.status).toBe(504)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('adapts the (req, res) proxy contract to a promise', async () => {
    const out = await callOverpassProxy('[out:json];', '1.2.3.4', proxy())
    expect(out.status).toBe(200)
    expect(out.body.elements).toHaveLength(2)
  })
  it('rejects if the proxy throws', async () => {
    await expect(callOverpassProxy('q', 'ip', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })
})
