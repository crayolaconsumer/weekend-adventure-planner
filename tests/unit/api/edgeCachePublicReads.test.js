import { describe, it, expect, vi, beforeEach } from 'vitest'

// Issue #22: public GET reads must be shareable at Vercel's edge, which
// refuses to cache any response whose Vary names Cookie. Anything sent with a
// credential stays private, no-store, so a personalised answer is never stored.

let user = null
let rows = []
let promotedOn = true
let failQuery = false
let queryHook = null // optional (sql) => rows, overrides the default

vi.mock('../../../api/lib/auth.js', async importOriginal => ({
  ...(await importOriginal()), // real extractToken
  getUserFromRequest: async () => user,
}))
vi.mock('../../../api/lib/db.js', () => ({
  query: async sql => { if (queryHook) return queryHook(sql); if (failQuery) throw new Error('db down'); return rows },
  queryOne: async () => null, insert: async () => 0, update: async () => 0, transaction: async () => null,
}))
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => promotedOn }))
vi.mock('../../../api/lib/pushNotifications.js', () => ({ notifyContributionUpvote: async () => {}, notifyContributionRemoved: async () => {} }))
vi.mock('../../../api/users/badges.js', () => ({ evaluateBadges: async () => {} }))
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }))

const { shareIfAnonymous, TIPS_CACHE, TRENDING_CACHE } = await import('../../../api/lib/edgeCache.js')
const { default: batch, _resetTippedCache } = await import('../../../api/contributions/batch.js')
const { default: contributions } = await import('../../../api/contributions/index.js')
const { default: trending, _resetTrendingMemo } = await import('../../../api/places/trending.js')
const { default: sponsored } = await import('../../../api/ads/sponsored.js')
const { default: promoted } = await import('../../../api/events/promoted.js')

function mockRes() {
  return {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    getHeader(k) { return this.headers[k.toLowerCase()] },
    removeHeader(k) { delete this.headers[k.toLowerCase()] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this },
  }
}

let ip = 0
async function call(handler, query, headers = {}) {
  const res = mockRes()
  await handler({ method: 'GET', query, headers: { origin: 'https://www.go-roam.uk', 'x-forwarded-for': `10.9.0.${++ip}`, ...headers } }, res)
  return res
}

const isShared = res => /s-maxage|public/.test(res.headers['cache-control'] || '')

const BEARER = { authorization: 'Bearer tok' }
const COOKIE = { cookie: 'ph_x=1; roam_token=tok' }

beforeEach(() => {
  user = null; rows = []; promotedOn = true; failQuery = false; queryHook = null
  _resetTippedCache(); _resetTrendingMemo()
})

describe('shareIfAnonymous', () => {
  it('shares a credential-free request, varied on Authorization, never on Cookie', () => {
    const res = mockRes()
    res.setHeader('Vary', 'Origin')
    res.setHeader('X-RateLimit-Remaining', 5)
    expect(shareIfAnonymous({ headers: { cookie: 'ph_x=1' } }, res, TIPS_CACHE)).toBe(true)
    expect(res.headers['cache-control']).toBe(TIPS_CACHE)
    expect(res.headers.vary).toBe('Origin, Authorization')
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined()
  })

  it.each([['Bearer', BEARER], ['web session cookie', COOKIE]])('keeps a %s request private, no-store', (_, headers) => {
    const res = mockRes()
    expect(shareIfAnonymous({ headers }, res, TIPS_CACHE)).toBe(false)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('never stores a URL carrying the signed-in viewer marker, even sent with no credential', () => {
    // Otherwise anyone could fill ?viewer=1 with the guest copy and the CDN
    // would hand it to cookie-only signed-in tabs
    const res = mockRes()
    expect(shareIfAnonymous({ headers: {}, query: { viewer: '1' } }, res, TIPS_CACHE)).toBe(false)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})

// Routes whose body depends on the viewer. A guest gets the shared copy; every
// credentialed request (valid user, or a dead token) gets a private answer.
const PERSONALISED = [
  ['contributions/batch', batch, { placeIds: 'node/1,node/2' }, TIPS_CACHE],
  ['contributions (place)', contributions, { placeId: 'node/1' }, TIPS_CACHE],
  ['places/trending', trending, { limit: '10', days: '7' }, TRENDING_CACHE],
]

describe.each(PERSONALISED)('GET /api/%s', (_, handler, query, cache) => {
  it('guest: shared at the edge, no Vary: Cookie', async () => {
    const res = await call(handler, query)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe(cache)
    expect(res.headers.vary).toMatch(/Origin/)
    expect(res.headers.vary).toMatch(/Authorization/)
    expect(res.headers.vary).not.toMatch(/Cookie/i)
    expect(Object.keys(res.headers).filter(h => h.startsWith('x-ratelimit'))).toEqual([])
  })

  it.each([['Bearer (native, web)', BEARER], ['cookie only (web)', COOKIE]])('signed in via %s: never shared', async (_l, headers) => {
    user = { id: 7 }
    const res = await call(handler, query, headers)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(isShared(res)).toBe(false)
  })

  it('a dead token is still never shared (its URL must not fill the cache)', async () => {
    user = null
    const res = await call(handler, query, BEARER)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})

describe('GET /api/contributions partial answers', () => {
  it('a list missing its reviews (enrichment failed) is not shared', async () => {
    queryHook = sql => { if (sql.includes('place_ratings')) throw new Error('db blip'); return [] }
    const res = await call(contributions, { placeId: 'node/1' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})

describe('GET /api/contributions personalised answers', () => {
  it('a response carrying the viewer\'s own vote is never shared', async () => {
    user = { id: 7 }
    rows = [{ id: 1, place_id: 'node/1', contribution_type: 'tip', content: 'x', metadata: null, upvotes: 1, downvotes: 0, created_at: '2026-01-01', user_id: 9, username: 'u', display_name: 'U', avatar_url: null, user_vote: 'up' }]
    const res = await call(contributions, { placeId: 'node/1' }, BEARER)
    expect(res.body.contributions[0].userVote).toBe('up')
    expect(isShared(res)).toBe(false)
  })
})

describe('GET /api/ads/sponsored', () => {
  it('is shared at the edge for everyone, rate-limit counters dropped', async () => {
    rows = [{ sponsored_id: 1, place_id: 'p1', place_data: '{"name":"Cafe","lat":51.5,"lng":-0.1}', business_name: 'B', owner_response: null }]
    const res = await call(sponsored, { limit: '3' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=120')
    expect(res.headers.vary).not.toMatch(/Cookie/i)
    expect(Object.keys(res.headers).filter(h => h.startsWith('x-ratelimit'))).toEqual([])
    expect(res.body.sponsored[0].place.distance).toBeNull() // no location sent: client computes it
  })

  it('old clients that still send lat/lng get a distance', async () => {
    rows = [{ sponsored_id: 1, place_id: 'p1', place_data: { name: 'Cafe', lat: 51.5, lng: -0.1 }, business_name: 'B', owner_response: null }]
    const res = await call(sponsored, { lat: '51.51', lng: '-0.1' })
    expect(res.body.sponsored[0].place.distance).toBeCloseTo(1.1, 1)
  })

  it('errors are never cached', async () => {
    failQuery = true
    const res = await call(sponsored, {})
    expect(res.statusCode).toBe(500)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})

describe('GET /api/events/promoted', () => {
  const q = { lat: '51.51', lng: '-0.13', radiusKm: '30' }

  it('is shared at the edge for 5 min', async () => {
    rows = [{ id: 1, title: 'Gig', lat: 51.52, lng: -0.13, promo_radius_km: 50, starts_at: '2026-11-01T19:00:00Z', org_name: 'O' }]
    const res = await call(promoted, q)
    expect(res.body.count).toBe(1)
    expect(res.headers['cache-control']).toBe('public, s-maxage=300, stale-while-revalidate=600')
    expect(Object.keys(res.headers).filter(h => h.startsWith('x-ratelimit'))).toEqual([])
  })

  it('keeps an event just outside the paid radius from the rounded point (client decides on the exact one)', async () => {
    // User at 51.4955,-0.1349 sends 51.5,-0.13. Venue is 4.63 km from the user
    // but 5.23 km from the rounded point; paid radius 5 km.
    rows = [{ id: 1, title: 'Edge gig', lat: 51.46108, lng: -0.17238, promo_radius_km: 5, starts_at: '2026-11-01T19:00:00Z', org_name: 'O' }]
    const res = await call(promoted, { lat: '51.5', lng: '-0.13', radiusKm: '30' })
    expect(res.body.count).toBe(1)
    expect(res.body.promoted[0].promoRadiusKm).toBe(5)
  })

  it('the kill-switch-off answer is not cached (switching back on is immediate)', async () => {
    promotedOn = false
    const res = await call(promoted, q)
    expect(res.body).toEqual({ promoted: [], count: 0 })
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('the fail-soft empty answer on a DB error is never cached', async () => {
    failQuery = true
    const res = await call(promoted, q)
    expect(res.body).toEqual({ promoted: [], count: 0 })
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})
