import { describe, it, expect, vi } from 'vitest'

let user = null
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => user }))
vi.mock('../../../api/lib/db.js', () => ({ query: async () => [], queryOne: async () => null, insert: async () => 0, update: async () => 0, transaction: async () => null }))
vi.mock('../../../api/lib/pushNotifications.js', () => ({ notifyContributionUpvote: async () => {}, notifyContributionRemoved: async () => {} }))
vi.mock('../../../api/users/badges.js', () => ({ evaluateBadges: async () => {} }))
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }))

const { default: handler } = await import('../../../api/contributions/index.js')

async function get(headers = {}) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    getHeader(k) { return this.headers[k.toLowerCase()] },
    removeHeader(k) { delete this.headers[k.toLowerCase()] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this }
  }
  await handler({ method: 'GET', query: { placeId: 'node/1' }, headers: { origin: 'https://www.go-roam.uk', ...headers } }, res)
  return res
}

describe('GET /api/contributions caching', () => {
  it('anonymous views are CDN-cacheable, varied on credentials', async () => {
    user = null
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=300')
    expect(res.headers.vary).toMatch(/Authorization/)
    expect(res.headers.vary).toMatch(/Cookie/)
    expect(res.headers.vary).toMatch(/Origin/) // withCors' Vary survives
  })

  it('signed-in views (own votes, pending posts) are never shared', async () => {
    user = { id: 7 }
    const res = await get({ authorization: 'Bearer x' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})
