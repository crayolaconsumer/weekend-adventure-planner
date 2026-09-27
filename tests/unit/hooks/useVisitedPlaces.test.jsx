import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const auth = { isAuthenticated: true, loading: false }
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../../src/utils/authToken', () => ({ getAuthToken: () => 'tok' }))

const { useVisitedPlaces } = await import('../../../src/hooks/useVisitedPlaces')

describe('useVisitedPlaces logout', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.assign(auth, { isAuthenticated: true, loading: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ visited: [{ placeId: 'p1' }] }), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it("clears the previous user's visits", async () => {
    const { result, rerender } = renderHook(() => useVisitedPlaces())
    await waitFor(() => expect(result.current.visitedPlaces).toHaveLength(1))
    expect(localStorage.getItem('roam_visited_places')).not.toBeNull()

    auth.isAuthenticated = false
    rerender()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(localStorage.getItem('roam_visited_places')).toBeNull()
    expect(result.current.visitedPlaces).toEqual([])
  })
})
