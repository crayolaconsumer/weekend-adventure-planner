import { describe, it, expect, beforeEach, vi } from 'vitest'

// POST /api/places/saved/migrate imports a user's pre-signup saves. It must
// never drop any: a new account imports everything (in chunks, with retries),
// an older account keeps the free cap, and places already saved never use
// up the cap. Uses a stateful fake DB so chunking and retries behave as live.

let saved // Set of place_ids for the current user
let failNext = 0
// Mirrors mysql2 with FOUND_ROWS (its default): ON DUPLICATE KEY UPDATE
// reports a duplicate as 1 affected row; INSERT IGNORE reports 0
const query = vi.fn(async (sql, [, placeId, , savedAt]) => {
  if (!/INSERT (IGNORE )?INTO saved_places/.test(sql)) return { affectedRows: 0 }
  if (failNext > 0) { failNext--; throw new Error('db blip') }
  if (savedAt instanceof Date && Number.isNaN(savedAt.getTime())) throw new Error('Incorrect datetime value')
  if (saved.has(placeId)) return { affectedRows: /ON DUPLICATE KEY/.test(sql) ? 1 : 0 }
  saved.add(placeId)
  return { affectedRows: 1 }
})
const queryOne = vi.fn(async (sql, params) => {
  if (/COUNT\(\*\)/.test(sql)) return { count: saved.size }
  if (/SELECT 1 AS found/.test(sql)) return saved.has(params[1]) ? { found: 1 } : null
  return null
})
let currentUser

vi.mock('../../../api/lib/db.js', () => ({
  query: (...a) => query(...a),
  queryOne: (...a) => queryOne(...a),
}))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))
vi.mock('../../../api/lib/auth.js', async (importActual) => ({
  ...(await importActual()),
  getUserFromRequest: async () => currentUser,
}))

const { default: handler } = await import('../../../api/places/saved/migrate.js')

async function run(places) {
  const out = { status: 200, body: null }
  const res = {
    setHeader() {},
    status(c) { out.status = c; return this },
    json(b) { out.body = b; return this },
    end() { return this },
  }
  await handler({ method: 'POST', headers: {}, body: { places } }, res)
  return out
}

const places = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${i + from}` }))
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  saved = new Set()
  failNext = 0
  query.mockClear()
  queryOne.mockClear()
  currentUser = { id: 1, tier: 'free', created_at: new Date().toISOString() }
})

describe('saved places migrate', () => {
  it('a new free account imports all 700 saves across two chunks (regression: second chunk capped)', async () => {
    const first = await run(places(500))
    const second = await run(places(200, 500))
    expect(first.body).toMatchObject({ success: true, migrated: 500 })
    expect(second.body).toMatchObject({ success: true, migrated: 200, capped: 0 })
    expect(saved.size).toBe(700)
  })

  it('a failed row is imported on the retry, and the already-saved ones are just skipped (regression)', async () => {
    failNext = 1
    const first = await run(places(20))
    expect(first.body).toMatchObject({ success: false, migrated: 19, failed: 1 })
    const retry = await run(places(20))
    expect(retry.body).toMatchObject({ success: true, migrated: 1, skipped: 19, failed: 0, capped: 0 })
    expect(saved.size).toBe(20)
  })

  it('an older free account keeps the cap, reports overflow as capped, and replaying cannot bypass it', async () => {
    currentUser = { ...currentUser, created_at: new Date(Date.now() - 7 * DAY).toISOString() }
    const out = await run(places(15))
    expect(out.body).toMatchObject({ migrated: 10, capped: 5, limitReached: true })
    const replay = await run(places(15))
    expect(replay.body).toMatchObject({ migrated: 0, skipped: 10, capped: 5 })
    expect(saved.size).toBe(10)
  })

  it('a corrupt savedAt is imported with the current time, not failed forever', async () => {
    const out = await run([{ id: 'x', savedAt: 'not a date' }])
    expect(out.body).toMatchObject({ success: true, migrated: 1, failed: 0 })
  })

  it('does not cap premium users', async () => {
    currentUser = { id: 1, tier: 'premium', created_at: new Date(Date.now() - 30 * DAY).toISOString() }
    const out = await run(places(30))
    expect(out.body.migrated).toBe(30)
  })

  it('rejects arrays over 500 with an error so the client keeps them', async () => {
    const out = await run(places(501))
    expect(out.status).toBe(413)
    expect(saved.size).toBe(0)
  })
})
