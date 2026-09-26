import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCurrentTown } from '../../../src/hooks/useCurrentTown'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

describe('useCurrentTown', () => {
  it('resolves the user\'s town from a ~1km cell, once per cell', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ town: { slug: 'hatfield', name: 'Hatfield', lat: 1 } }) }))
    const { result, rerender } = renderHook(({ loc }) => useCurrentTown(loc), { initialProps: { loc: { lat: 51.76312, lng: -0.22591 } } })
    await waitFor(() => expect(result.current).toEqual({ slug: 'hatfield', name: 'Hatfield' }))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/town?near=51.76,-0.23&format=json')
    rerender({ loc: { lat: 51.76398, lng: -0.22544 } }) // same cell
    await waitFor(() => expect(result.current).toEqual({ slug: 'hatfield', name: 'Hatfield' }))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('never names a town for the London fallback or no location', () => {
    globalThis.fetch = vi.fn()
    expect(renderHook(() => useCurrentTown({ lat: 51.5074, lng: -0.1278, isFallback: true })).result.current).toBe(null)
    expect(renderHook(() => useCurrentTown(null)).result.current).toBe(null)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('stays null (and retries next time) if the lookup fails', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
    const { result } = renderHook(() => useCurrentTown({ lat: 10.01, lng: 10.01 }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(result.current).toBe(null)
  })
})
