import { describe, it, expect, vi, beforeEach } from 'vitest'
import process from 'node:process'
import { randomBytes } from 'node:crypto'

const store = new Map()
const set = vi.fn(async (k, v) => { store.set(k, v); return 'OK' })
const get = vi.fn(async (k) => store.get(k) ?? null)
vi.mock('@upstash/redis', () => ({ Redis: class { set(...a) { return set(...a) } get(...a) { return get(...a) } } }))
process.env.KV_REST_API_URL = 'https://kv.test'
process.env.KV_REST_API_TOKEN = 't'
const { cacheSet, cacheGet } = await import('../../../api/lib/kvCache.js')

beforeEach(() => { store.clear(); set.mockClear() })

describe('kvCache size guard', () => {
  it('skips payloads over the KV request limit (even compressed) instead of failing', async () => {
    const big = { elements: [{ tags: { name: randomBytes(1024 * 1024).toString('base64') } }] }
    await expect(cacheSet('k', big, 60)).resolves.toBe(false)
    expect(set).not.toHaveBeenCalled()
  })
  it('stores small payloads as plain JSON', async () => {
    await expect(cacheSet('k', { elements: [1] }, 60)).resolves.toBe(true)
    expect(set).toHaveBeenCalledWith('k', '{"elements":[1]}', { ex: 60 })
  })
})

describe('kvCache compression (regression: free-plan storage hit 100%)', () => {
  it('stores a big Overpass-like payload gzipped, several times smaller, and reads it back intact', async () => {
    const elements = Array.from({ length: 3000 }, (_, i) => ({ type: 'node', id: i, lat: 51.5 + i / 1e5, lon: -0.1, tags: { name: `Place ${i}`, amenity: 'cafe', opening_hours: 'Mo-Su 08:00-18:00' } }))
    const value = { elements }
    const plainBytes = JSON.stringify(value).length
    await expect(cacheSet('tile', value, 60)).resolves.toBe(true)
    const stored = store.get('tile')
    expect(stored.startsWith('gz1:')).toBe(true)
    expect(stored.length).toBeLessThan(plainBytes / 4)
    expect(await cacheGet('tile')).toEqual(value)
  })
  it('still reads entries written before compression', async () => {
    store.set('old', JSON.stringify({ elements: [1, 2] }))
    expect(await cacheGet('old')).toEqual({ elements: [1, 2] })
  })
})
