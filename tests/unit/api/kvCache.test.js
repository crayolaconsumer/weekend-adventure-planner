import { describe, it, expect, vi } from 'vitest'
import process from 'node:process'

const set = vi.fn(async () => 'OK')
vi.mock('@upstash/redis', () => ({ Redis: class { set(...a) { return set(...a) } } }))
process.env.KV_REST_API_URL = 'https://kv.test'
process.env.KV_REST_API_TOKEN = 't'
const { cacheSet } = await import('../../../api/lib/kvCache.js')

describe('kvCache size guard', () => {
  it('skips payloads over the KV request limit instead of failing', async () => {
    const big = { elements: [{ tags: { name: 'x'.repeat(1024 * 1024) } }] }
    await expect(cacheSet('k', big, 60)).resolves.toBe(false)
    expect(set).not.toHaveBeenCalled()
  })
  it('stores normal payloads', async () => {
    await expect(cacheSet('k', { elements: [1] }, 60)).resolves.toBe(true)
    expect(set).toHaveBeenCalledWith('k', '{"elements":[1]}', { ex: 60 })
  })
})
