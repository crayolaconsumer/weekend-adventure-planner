// Each real success point records exactly one happy moment (review prompt input);
// failures and edits record none.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const auth = { isAuthenticated: true, loading: false }
const recordHappyMoment = vi.fn()
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../../src/utils/authToken', () => ({ getAuthToken: () => 'tok' }))
vi.mock('../../../src/utils/analytics', () => ({ track: () => {} }))
vi.mock('../../../src/utils/reviewPrompt', () => ({ recordHappyMoment: (...a) => recordHappyMoment(...a) }))

const { useSavedPlaces } = await import('../../../src/hooks/useSavedPlaces')
const { useVisitedPlaces } = await import('../../../src/hooks/useVisitedPlaces')

let postStatus = 200
beforeEach(() => {
  localStorage.clear()
  recordHappyMoment.mockClear()
  Object.assign(auth, { isAuthenticated: true, loading: false })
  postStatus = 200
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => opts.method === 'POST'
    ? new Response('{}', { status: postStatus })
    : new Response(JSON.stringify({ places: [], visited: [] }), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('useSavedPlaces.savePlace', () => {
  async function save() {
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let res
    await act(async () => { res = await result.current.savePlace({ id: 'c', name: 'C' }) })
    return res
  }

  it('logged in: one place_saved moment after the server accepts it', async () => {
    expect((await save()).success).toBe(true)
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
    expect(recordHappyMoment).toHaveBeenCalledWith('place_saved')
  })

  it('logged in: no moment when the save fails', async () => {
    postStatus = 500
    expect((await save()).success).toBe(false)
    expect(recordHappyMoment).not.toHaveBeenCalled()
  })

  async function saveTwice() {
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.savePlace({ id: 'c', name: 'C' }) })
    await act(async () => { await result.current.savePlace({ id: 'c', name: 'C', note: 'again' }) })
  }

  it('logged in: re-saving a place already saved is not another moment', async () => {
    await saveTwice()
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })

  it('anonymous: re-saving a place already saved is not another moment', async () => {
    auth.isAuthenticated = false
    await saveTwice()
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })

  it('anonymous: one place_saved moment for a local save', async () => {
    auth.isAuthenticated = false
    expect((await save()).success).toBe(true)
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
    expect(recordHappyMoment).toHaveBeenCalledWith('place_saved')
  })
})

describe('useVisitedPlaces.markVisited', () => {
  it('one visit_marked moment for a new visit, none for editing it', async () => {
    const { result } = renderHook(() => useVisitedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.markVisited({ id: 'p1', name: 'P' }, 5) })
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
    expect(recordHappyMoment).toHaveBeenCalledWith('visit_marked')
    await act(async () => { await result.current.markVisited({ id: 'p1', name: 'P' }, 1) }) // review edit
    expect(recordHappyMoment).toHaveBeenCalledTimes(1)
  })
})
