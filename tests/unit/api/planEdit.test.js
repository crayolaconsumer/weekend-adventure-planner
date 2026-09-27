import { describe, it, expect, beforeEach, vi } from 'vitest'

// PUT /api/plans/:id must apply the same title / stop-count / stop-size
// rules as plan create.

const update = vi.fn(async () => 1)
const connQuery = vi.fn(async () => [])
const transaction = vi.fn(async (fn) => fn({ query: connQuery }))

vi.mock('../../../api/lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(async () => ({ user_id: 1 })),
  update: (...a) => update(...a),
  transaction: (...a) => transaction(...a),
}))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))
vi.mock('../../../api/lib/auth.js', () => ({ getUserFromRequest: async () => ({ id: 1 }) }))

const { default: handler } = await import('../../../api/plans/[id].js')

async function put(body) {
  const out = { status: 200, body: null }
  const res = {
    setHeader() {},
    status(c) { out.status = c; return this },
    json(b) { out.body = b; return this },
    end() { return this },
  }
  await handler({ method: 'PUT', headers: {}, query: { id: '5' }, body }, res)
  return out
}

const stops = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ placeId: `p${i}`, placeData: { name: 'x', ...extra } }))
const wrote = () => update.mock.calls.length + transaction.mock.calls.length

beforeEach(() => {
  update.mockClear()
  transaction.mockClear()
})

describe('plan edit validation', () => {
  it('rejects more than 20 stops', async () => {
    const out = await put({ stops: stops(21) })
    expect(out.status).toBe(400)
    expect(wrote()).toBe(0)
  })

  it('rejects an oversized stop', async () => {
    const out = await put({ stops: stops(1, { blob: 'a'.repeat(11 * 1024) }) })
    expect(out.status).toBe(400)
    expect(wrote()).toBe(0)
  })

  it('rejects an invalid title', async () => {
    expect((await put({ title: '' })).status).toBe(400)
    expect((await put({ title: 'a'.repeat(101) })).status).toBe(400)
    expect(wrote()).toBe(0)
  })

  it('accepts a valid edit', async () => {
    const out = await put({ title: 'Saturday', stops: stops(20) })
    expect(out.status).toBe(200)
    expect(update).toHaveBeenCalled()
    expect(transaction).toHaveBeenCalled()
  })
})
