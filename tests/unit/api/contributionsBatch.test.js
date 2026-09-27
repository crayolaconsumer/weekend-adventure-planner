import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake contributions table: one tip per visibility, plus a follow edge 7 -> 20.
const TIPS = [
  { id: 1, place_id: 'node/pub', user_id: 10, visibility: 'public' },
  { id: 2, place_id: 'node/fo', user_id: 20, visibility: 'followers_only' },
  { id: 3, place_id: 'node/priv', user_id: 30, visibility: 'private' },
]
const FOLLOWS = [{ follower_id: 7, following_id: 20 }]

let user = null
let failSetLoad = false
const calls = []

// Evaluates the visibility clause the handler actually sent. A query with no
// visibility clause returns every tip (the old leaky behaviour), so dropping
// the filter from batch.js fails the visibility tests.
function fakeQuery(sql, params = []) {
  calls.push({ sql, params })
  if (sql.includes('SELECT DISTINCT place_id')) {
    if (failSetLoad) return Promise.reject(new Error('db down'))
    return Promise.resolve([...new Set(TIPS.map(t => t.place_id))].map(place_id => ({ place_id })))
  }
  const ids = params.filter(p => typeof p === 'string')
  const viewer = params.find(p => typeof p === 'number')
  const visible = t => {
    if (!sql.includes('c.visibility')) return true
    if (!sql.includes('FROM follows')) return t.visibility === 'public'
    return t.visibility === 'public' || t.user_id === viewer ||
      (t.visibility === 'followers_only' && FOLLOWS.some(f => f.follower_id === viewer && f.following_id === t.user_id))
  }
  return Promise.resolve(TIPS.filter(t => ids.includes(t.place_id) && visible(t)).map(t => ({
    id: t.id, place_id: t.place_id, content: `tip ${t.id}`, upvotes: 3, downvotes: 1, score: 2,
    created_at: '2026-01-01T00:00:00.000Z', user_id: t.user_id, username: `u${t.user_id}`,
    display_name: `User ${t.user_id}`, avatar_url: null, user_contribution_count: 6, user_avg_score: 3,
  })))
}

vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => user }))
vi.mock('../../../api/lib/db.js', () => ({ query: (...a) => fakeQuery(...a) }))

const { default: handler, _resetTippedCache } = await import('../../../api/contributions/batch.js')

let ip = 0
async function get(placeIds, headers = {}) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    getHeader(k) { return this.headers[k.toLowerCase()] },
    removeHeader(k) { delete this.headers[k.toLowerCase()] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this },
  }
  await handler({
    method: 'GET', query: { placeIds },
    headers: { origin: 'https://www.go-roam.uk', 'x-forwarded-for': `10.0.0.${++ip}`, ...headers },
  }, res)
  return res
}
const tipQueries = () => calls.filter(c => !c.sql.includes('SELECT DISTINCT'))
const visibleIds = res => Object.keys(res.body.contributions).filter(k => res.body.contributions[k])

beforeEach(() => {
  _resetTippedCache()
  calls.length = 0
  user = null
  failSetLoad = false
  vi.useRealTimers()
})

describe('GET /api/contributions/batch: no-tip shortcut', () => {
  it('answers places with no tips without querying contributions', async () => {
    const res = await get('node/a,node/b,way/c')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ contributions: { 'node/a': null, 'node/b': null, 'way/c': null } })
    expect(tipQueries()).toHaveLength(0)
    expect(calls).toHaveLength(1) // just the tipped-set load

    await get('node/d,node/e')
    expect(calls).toHaveLength(1) // set is cached: zero queries for the second deck chunk
  })

  it('queries only the ids that have tips', async () => {
    const res = await get('node/a,node/pub,node/b')
    expect(tipQueries()).toHaveLength(1)
    expect(tipQueries()[0].params).toEqual(['node/pub'])
    expect(res.body.contributions['node/a']).toBeNull()
    expect(res.body.contributions['node/pub']).toEqual({
      id: 1, content: 'tip 1', score: 2, createdAt: '2026-01-01T00:00:00.000Z',
      user: { id: 10, username: 'u10', displayName: 'User 10', avatarUrl: null, isTrusted: true, contributionCount: 6 },
    })
  })

  it('reloads the set after 60s and loads it once for concurrent requests', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await Promise.all([get('node/a'), get('node/b'), get('node/c')])
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(61_000)
    await get('node/a')
    expect(calls).toHaveLength(2)
  })

  it('falls back to the full query when the set cannot load', async () => {
    failSetLoad = true
    const res = await get('node/a,node/pub')
    expect(res.statusCode).toBe(200)
    expect(tipQueries()[0].params).toEqual(['node/a', 'node/pub'])
    expect(visibleIds(res)).toEqual(['node/pub'])
  })
})

describe('GET /api/contributions/batch: visibility', () => {
  const ALL = 'node/pub,node/fo,node/priv'

  it('anonymous viewers see public tips only, and that answer is CDN-shared', async () => {
    const res = await get(ALL)
    expect(visibleIds(res)).toEqual(['node/pub'])
    expect(res.headers['cache-control']).toBe('public, s-maxage=60')
    expect(res.headers.vary).toMatch(/Authorization/)
    expect(res.headers.vary).toMatch(/Cookie/)
    expect(res.headers.vary).toMatch(/Origin/)
    expect(Object.keys(res.headers).filter(h => h.startsWith('x-ratelimit'))).toEqual([])
  })

  it('followers_only tips never reach a signed-in non-follower', async () => {
    user = { id: 8 }
    const res = await get(ALL, { authorization: 'Bearer x' })
    expect(visibleIds(res)).toEqual(['node/pub'])
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('followers see followers_only tips; private stays with its author', async () => {
    user = { id: 7 }
    const follower = await get(ALL, { authorization: 'Bearer x' })
    expect(visibleIds(follower).sort()).toEqual(['node/fo', 'node/pub'])
    expect(follower.headers['cache-control']).toBe('private, no-store')

    user = { id: 30 }
    const author = await get(ALL, { authorization: 'Bearer y' })
    expect(visibleIds(author).sort()).toEqual(['node/priv', 'node/pub'])
  })

  it('a follower warming the cache does not leak followers_only to anonymous viewers', async () => {
    user = { id: 7 }
    await get(ALL, { authorization: 'Bearer x' })
    user = null
    const res = await get(ALL)
    expect(visibleIds(res)).toEqual(['node/pub'])
    expect(res.headers['cache-control']).toBe('public, s-maxage=60')
  })

  // The fake DB above reads the clause loosely; this pins the exact rule, so a
  // widened filter (e.g. "OR c.visibility = 'private'") fails here
  it('sends exactly the GET /api/contributions visibility rule', async () => {
    const norm = sql => sql.replace(/\s+/g, ' ')
    calls.length = 0
    await get(ALL)
    expect(norm(calls.at(-1).sql)).toContain("AND c.visibility = 'public'")
    expect(norm(calls.at(-1).sql)).not.toMatch(/'private'|'followers_only'/)
    const src = norm(readFileSync('api/contributions/batch.js', 'utf8'))
    expect(src).toContain("AND ( c.visibility = 'public' OR c.user_id = ? OR (c.visibility = 'followers_only' AND EXISTS ( SELECT 1 FROM follows WHERE follower_id = ? AND following_id = c.user_id )) )")
  })
})
