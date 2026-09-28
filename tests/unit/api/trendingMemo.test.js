import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The global trending ranking (a 30-day UNION/GROUP BY over three tables) runs at
// most once per 5 min per instance; viewer block filters still run per request
const query = vi.fn()
let viewer = null
vi.mock('../../../api/lib/db.js', () => ({ query: (...a) => query(...a) }))
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => viewer }))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))

const { default: handler, _resetTrendingMemo, publicPlaceData } = await import('../../../api/places/trending.js')

const RANK = [{ place_id: 'p1', contribution_count: 1, save_count: 2, visit_count: 0, popularity_score: 5 }]
function route(sql) {
  if (sql.includes('popularity_score')) return RANK
  if (sql.includes("contribution_type = 'tip'")) return []
  if (sql.includes("contribution_type = 'photo'")) return []
  if (sql.includes('place_data')) return [{ place_id: 'p1', place_data: JSON.stringify({ name: 'Minster' }) }]
  throw new Error(`unexpected ${sql}`)
}
const calls = kind => query.mock.calls.filter(([sql]) => ({
  rank: sql.includes('popularity_score'), data: sql.includes('place_data') && !sql.includes('popularity_score'), tips: sql.includes("contribution_type = 'tip'")
})[kind]).length

async function get(q = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] }, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, end() { return this } }
  await handler({ method: 'GET', query: q, headers: { origin: 'https://www.go-roam.uk' } }, res)
  return res
}

describe('trending: global ranking memoized per instance', () => {
  beforeEach(() => { _resetTrendingMemo(); query.mockReset(); query.mockImplementation(async sql => route(sql)); viewer = null })
  afterEach(() => vi.useRealTimers())

  it('50 requests run the ranking and place-data queries once; tips still per request', async () => {
    for (let i = 0; i < 50; i++) expect((await get()).body.trending[0].placeName).toBe('Minster')
    expect(calls('rank')).toBe(1)
    expect(calls('data')).toBe(1)
    expect(calls('tips')).toBe(50)
  })

  it('20 concurrent requests share one in-flight ranking run', async () => {
    let release
    query.mockImplementation(sql => sql.includes('popularity_score') ? new Promise(r => { release = () => r(RANK) }) : route(sql))
    const pending = Array.from({ length: 20 }, () => get())
    await new Promise(r => setTimeout(r, 10))
    release()
    const out = await Promise.all(pending)
    expect(out.map(o => o.statusCode)).toEqual(Array(20).fill(200))
    expect(calls('rank')).toBe(1)
  })

  it('never holds more than 200 entries (a days x limit sweep)', async () => {
    for (let days = 1; days <= 90; days++) for (const limit of [1, 2, 3]) await get({ days: String(days), limit: String(limit) })
    query.mockClear()
    await get({ days: '1', limit: '1' }) // evicted long ago: runs again
    expect(calls('rank')).toBe(1)
  })

  it('refreshes after 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await get()
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    await get()
    expect(calls('rank')).toBe(2)
  })

  it('a failed ranking query is not cached', async () => {
    query.mockImplementationOnce(async () => { throw new Error('DB down') })
    expect((await get()).statusCode).toBe(500)
    expect((await get()).statusCode).toBe(200)
    expect(calls('rank')).toBe(2)
  })

  it('different windows and limits are separate entries', async () => {
    await get({ days: '7' })
    await get({ days: '30', limit: '5' })
    await get({ days: '7' })
    expect(calls('rank')).toBe(2)
  })

  const tipsAndPhotos = () => query.mock.calls.filter(([sql]) => /contribution_type = '(tip|photo)'/.test(sql))
  const placeholders = sql => (sql.match(/\?/g) || []).length

  it('anonymous viewers only ever get public tips and photos, never a banned author\'s', async () => {
    await get()
    const calls = tipsAndPhotos()
    expect(calls).toHaveLength(2)
    for (const [sql, params] of calls) {
      expect(sql).toContain("c.visibility = 'public'")
      expect(sql).not.toContain('followers_only')
      expect(sql).toContain('u.is_banned = FALSE')
      expect(placeholders(sql)).toBe(params.length)
    }
  })

  it('a signed-in viewer gets their own and followed followers_only tips/photos, block filter intact', async () => {
    viewer = { id: 42 }
    await get()
    const calls = tipsAndPhotos()
    expect(calls).toHaveLength(2)
    for (const [sql, params] of calls) {
      expect(sql).toMatch(/c\.visibility = 'public'\s+OR c\.user_id = \?/)
      expect(sql).toContain("c.visibility = 'followers_only' AND EXISTS")
      expect(sql).toContain('FROM follows WHERE follower_id = ? AND following_id = c.user_id')
      expect(sql).toContain('blocked_users')
      expect(sql).toContain('u.is_banned = FALSE')
      expect(placeholders(sql)).toBe(params.length)
      expect(params).toEqual(['p1', 42, 42, 42, 42])
    }
  })
})

describe('trending: a saver\'s place_data is never passed through', () => {
  beforeEach(() => { _resetTrendingMemo(); query.mockReset(); viewer = null })

  it('drops distance, image URLs and unknown fields; keeps what the card uses to name and picture the place', async () => {
    const saved = {
      name: 'York Minster', type: 'place_of_worship', category: { key: 'culture', label: 'Culture', secret: 'x' },
      lat: 53.962, lng: -1.082, distance: 0.4, image: 'https://evil.example/x.jpg', imageUrl: 'https://evil.example/y.jpg',
      photo: 'p', thumbnail: 't', images: ['i'], address: '1 Private Rd', userId: 7,
      tags: { wikipedia: 'en:York Minster', wikidata: 'Q1', 'addr:street': 'x', phone: '0123' }
    }
    query.mockImplementation(async sql => {
      if (sql.includes('popularity_score')) return RANK
      if (sql.includes("contribution_type = 'photo'")) return [{ place_id: 'p1', metadata: JSON.stringify({ photoUrl: 'https://abc.public.blob.vercel-storage.com/p.jpg' }) }]
      if (sql.includes("contribution_type = 'tip'")) return []
      return [{ place_id: 'p1', place_data: JSON.stringify(saved) }]
    })
    const res = await get()
    const pd = res.body.trending[0].placeData
    expect(pd).toEqual({
      name: 'York Minster', type: 'place_of_worship', category: { key: 'culture', label: 'Culture' },
      lat: 53.962, lng: -1.082, tags: { wikipedia: 'en:York Minster', wikidata: 'Q1' },
      image: 'https://abc.public.blob.vercel-storage.com/p.jpg' // an approved user photo, from contributions
    })
    expect(res.body.trending[0].placeName).toBe('York Minster')
    expect(res.body.trending[0].placeCategory).toBe('Culture')
  })

  it('handles junk safely', () => {
    for (const junk of [null, 'x', 5, [], [1]]) expect(publicPlaceData(junk)).toBeNull()
    expect(publicPlaceData({ name: 'x'.repeat(5000), lat: NaN, lng: Infinity })).toEqual({ name: 'x'.repeat(300) })
    expect(publicPlaceData({ name: { toString: 1 }, tags: 'nope' })).toEqual({})
    expect(publicPlaceData({ lat: '53.9', lng: -1, lon: 9999, name: 5, wikidata: 42, category: 'food' })).toEqual({ lng: -1, category: 'food' })
    expect(publicPlaceData(JSON.parse('{"__proto__":{"polluted":1},"name":"x"}'))).toEqual({ name: 'x' })
  })

  it('a saver\'s website never reaches the card (image-resolve would use its og:image)', () => {
    const out = publicPlaceData({ name: 'Cafe', website: 'https://evil.example', tags: { website: 'https://evil.example', 'contact:website': 'https://evil.example', wikimedia_commons: 'File:X.jpg' } })
    expect(JSON.stringify(out)).not.toContain('evil.example')
    expect(out).toEqual({ name: 'Cafe', tags: { wikimedia_commons: 'File:X.jpg' } })
  })
})
