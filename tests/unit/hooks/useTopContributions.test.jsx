import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import {
  useTopContributions,
  tipPrefetchIds,
  clearContributionCache,
  fetchBatchContributions,
} from '../../../src/hooks/useTopContributions'

const deck = n => Array.from({ length: n }, (_, i) => ({ place: { id: `node/${i}` } }))
const idsIn = url => new URL(url, 'http://x').searchParams.get('placeIds').split(',')

let fetchMock
beforeEach(() => {
  clearContributionCache()
  fetchMock = vi.fn(async url => ({
    ok: true,
    json: async () => ({
      contributions: Object.fromEntries(idsIn(url).map(id => [id, id === 'node/3' ? { id: 99, content: 'tip' } : null])),
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('tipPrefetchIds', () => {
  it('moves in chunks of 12 and always covers 12+ cards ahead', () => {
    const d = deck(60)
    for (let i = 0; i < 48; i++) {
      const ids = tipPrefetchIds(d, i)
      expect(ids).toEqual(tipPrefetchIds(d, Math.floor(i / 12) * 12)) // stable within a chunk
      expect(ids).toContain(`node/${i}`)
      expect(ids).toContain(`node/${i + 12}`)
    }
  })

  it('skips cards without a place id (ads)', () => {
    expect(tipPrefetchIds([{ isAd: true }, { place: { id: 'a' } }], 0)).toEqual(['a'])
  })
})

describe('useTopContributions over a 30-swipe session', () => {
  it('makes one request per new chunk of ids, and requests each id once', async () => {
    const d = deck(60)
    const { result, rerender } = renderHook(({ i }) => useTopContributions(tipPrefetchIds(d, i)), {
      initialProps: { i: 0 },
    })
    for (let i = 0; i < 30; i++) {
      await act(async () => rerender({ i }))
    }
    await waitFor(() => expect(result.current.contributions['node/35']).toBeNull())

    // Swipes 0, 12 and 24 each open a new chunk: 3 requests, not 30.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const requested = fetchMock.mock.calls.flatMap(([url]) => idsIn(url))
    expect(new Set(requested).size).toBe(requested.length)
    expect(requested).toHaveLength(48) // 24 up front, then 12 per chunk
    expect(result.current.contributions['node/3']).toEqual({ id: 99, content: 'tip' })
  })

  it('re-renders with the same ids (new array each render) do not refetch', async () => {
    const d = deck(30)
    const { rerender } = renderHook(() => useTopContributions(tipPrefetchIds(d, 5)))
    for (let k = 0; k < 10; k++) await act(async () => rerender())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fetchBatchContributions', () => {
  it('shares one in-flight request between overlapping callers', async () => {
    const [a, b] = await Promise.all([
      fetchBatchContributions(['node/1', 'node/3']),
      fetchBatchContributions(['node/3', 'node/1']),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ 'node/1': null, 'node/3': { id: 99, content: 'tip' } })
    expect(b).toEqual({ 'node/3': { id: 99, content: 'tip' }, 'node/1': null })
  })

  it('caches failures so a broken API is not hammered', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    expect(await fetchBatchContributions(['node/1'])).toEqual({ 'node/1': null })
    expect(await fetchBatchContributions(['node/1'])).toEqual({ 'node/1': null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
