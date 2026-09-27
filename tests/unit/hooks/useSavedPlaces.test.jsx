import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }))
vi.mock('../../../src/utils/authToken', () => ({ getAuthToken: () => 'tok' }))
vi.mock('../../../src/utils/analytics', () => ({ track: () => {} }))

const { useSavedPlaces } = await import('../../../src/hooks/useSavedPlaces')

const server = [{ id: 'a', name: 'A', savedAt: 1 }, { id: 'b', name: 'B', savedAt: 2 }]

describe('useSavedPlaces failed save (logged in)', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('roam_wishlist', JSON.stringify([{ id: 'anon', name: 'Anon' }]))
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => opts.method === 'POST'
      ? new Response('{}', { status: 500 })
      : new Response(JSON.stringify({ places: server }), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rolls back only the new place and never writes local storage', async () => {
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.places).toHaveLength(2))
    let res
    await act(async () => { res = await result.current.savePlace({ id: 'c', name: 'C' }) })
    expect(res.success).toBe(false)
    expect(result.current.places.map(p => p.id)).toEqual(['a', 'b'])
    expect(JSON.parse(localStorage.getItem('roam_wishlist'))).toEqual([{ id: 'anon', name: 'Anon' }])
  })

  it('a failed re-save restores the original entry', async () => {
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.places).toHaveLength(2))
    await act(async () => { await result.current.savePlace({ id: 'b', name: 'B2' }) })
    expect(result.current.places).toEqual(expect.arrayContaining([{ id: 'b', name: 'B', savedAt: 2 }]))
    expect(result.current.places).toHaveLength(2)
  })
})
