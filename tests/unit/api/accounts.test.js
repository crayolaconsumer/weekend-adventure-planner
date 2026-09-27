import { describe, it, expect, beforeEach, vi } from 'vitest'

// deleteUserAccount: Stripe cancel is best-effort, the DB delete is one
// transaction, and the user's photo blobs (which outlive the cascading
// contributions rows) are removed afterwards, best-effort.

const queryOne = vi.fn()
const connQuery = vi.fn(async () => [])
const transaction = vi.fn(async (fn) => fn({ query: connQuery }))
const list = vi.fn()
const del = vi.fn(async () => {})
const cancel = vi.fn(async () => ({}))

vi.mock('../../../api/lib/db.js', () => ({
  queryOne: (...a) => queryOne(...a),
  transaction: (...a) => transaction(...a),
}))
vi.mock('@vercel/blob', () => ({ list: (...a) => list(...a), del: (...a) => del(...a) }))
vi.mock('stripe', () => ({ default: class { constructor() { this.subscriptions = { cancel } } } }))

const { deleteUserAccount } = await import('../../../api/lib/accounts.js')

beforeEach(() => {
  queryOne.mockReset().mockResolvedValue({ subscription_id: null })
  connQuery.mockClear()
  transaction.mockClear()
  list.mockReset().mockResolvedValue({ blobs: [], hasMore: false })
  del.mockClear()
  cancel.mockClear()
})

describe('deleteUserAccount', () => {
  it('deletes swipes, reports and the user row inside one transaction', async () => {
    await deleteUserAccount(42)
    expect(transaction).toHaveBeenCalledTimes(1)
    const sqls = connQuery.mock.calls.map(([s, p]) => [s, p])
    expect(sqls[0]).toEqual(['DELETE FROM swiped_places WHERE user_id = ?', [42]])
    expect(sqls[1][0]).toMatch(/DELETE FROM content_reports/)
    expect(sqls[2]).toEqual(['DELETE FROM users WHERE id = ?', [42]])
  })

  it('cancels an active Stripe subscription', async () => {
    queryOne.mockResolvedValue({ subscription_id: 'sub_123' })
    await deleteUserAccount(42)
    expect(cancel).toHaveBeenCalledWith('sub_123')
  })

  it('still deletes when Stripe blows up', async () => {
    queryOne.mockResolvedValue({ subscription_id: 'sub_123' })
    cancel.mockRejectedValueOnce(new Error('stripe down'))
    await deleteUserAccount(42)
    expect(connQuery).toHaveBeenCalledWith('DELETE FROM users WHERE id = ?', [42])
  })

  it("deletes every page of the user's photo blobs, scoped to their folder", async () => {
    list
      .mockResolvedValueOnce({ blobs: [{ url: 'u1' }, { url: 'u2' }], hasMore: true, cursor: 'c1' })
      .mockResolvedValueOnce({ blobs: [{ url: 'u3' }], hasMore: false })
    await deleteUserAccount(42)
    expect(list).toHaveBeenNthCalledWith(1, expect.objectContaining({ prefix: 'contributions/42/' }))
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ prefix: 'contributions/42/', cursor: 'c1' }))
    expect(del).toHaveBeenCalledWith(['u1', 'u2'])
    expect(del).toHaveBeenCalledWith(['u3'])
  })

  it('does not fail the delete when blob cleanup fails', async () => {
    list.mockRejectedValue(new Error('no token'))
    await expect(deleteUserAccount(42)).resolves.toBeUndefined()
  })

  it('leaves blobs alone when the DB delete fails', async () => {
    transaction.mockRejectedValueOnce(new Error('db down'))
    await expect(deleteUserAccount(42)).rejects.toThrow('db down')
    expect(list).not.toHaveBeenCalled()
  })
})
