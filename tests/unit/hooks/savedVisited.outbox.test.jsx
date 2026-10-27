import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// Issue #23: signed-in saves and visits that fail for a reason that may pass
// (offline, 5xx) stay on screen and are retried later instead of rolling back.
// The saved list renders from the device cache before the network answers.

const auth = { isAuthenticated: true, loading: false }
const recordHappyMoment = vi.fn()
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../../src/utils/authToken', async importOriginal => ({ ...(await importOriginal()), getAuthToken: () => 'tok' }))
vi.mock('../../../src/utils/analytics', () => ({ track: () => {} }))
vi.mock('../../../src/utils/reviewPrompt', () => ({ recordHappyMoment: (...a) => recordHappyMoment(...a) }))

const { useSavedPlaces } = await import('../../../src/hooks/useSavedPlaces')
const { useVisitedPlaces } = await import('../../../src/hooks/useVisitedPlaces')
const { flushOutbox, pending } = await import('../../../src/utils/outbox')

let writeStatus // number, or 'offline'
let serverSaved
let serverVisited
let fetchMock
const outbox = () => JSON.parse(localStorage.getItem('roam_outbox') || '[]')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('roam_auth_token', 'tok') // "keep me signed in": device copies in localStorage
  recordHappyMoment.mockClear()
  Object.assign(auth, { isAuthenticated: true, loading: false })
  writeStatus = 200
  serverSaved = [{ id: 'a', name: 'A', savedAt: 1 }]
  serverVisited = []
  fetchMock = vi.fn(async (url, opts = {}) => {
    if (opts.method) {
      if (writeStatus === 'offline') throw new TypeError('Load failed')
      return new Response('{}', { status: writeStatus })
    }
    return new Response(JSON.stringify(url.includes('visited') ? { visited: serverVisited } : { places: serverSaved }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function mountSaved() {
  const hook = renderHook(() => useSavedPlaces())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await waitFor(() => expect(hook.result.current.places.length).toBeGreaterThan(0))
  return hook
}

describe('saved places: local-first', () => {
  it('renders the cached list before the network answers', async () => {
    localStorage.setItem('roam_saved_cache', JSON.stringify([{ id: 'cached', name: 'Cached' }]))
    fetchMock.mockImplementation(() => new Promise(() => {})) // network never answers
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.places.map(p => p.id)).toEqual(['cached'])
  })

  it('refreshes the cache from the server', async () => {
    localStorage.setItem('roam_saved_cache', JSON.stringify([{ id: 'stale' }]))
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.places.map(p => p.id)).toEqual(['a']))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('roam_saved_cache')).map(p => p.id)).toEqual(['a']))
  })

  it('never writes the signed-in list into the anonymous wishlist', async () => {
    localStorage.setItem('roam_wishlist', JSON.stringify([{ id: 'anon' }]))
    const { result } = await mountSaved()
    await act(async () => { await result.current.savePlace({ id: 'c' }) })
    expect(JSON.parse(localStorage.getItem('roam_wishlist'))).toEqual([{ id: 'anon' }])
  })
})

describe('saved places: guest to signed-in', () => {
  it('the guest wishlist on screen when sign-in lands never becomes the account cache', async () => {
    auth.isAuthenticated = false
    localStorage.setItem('roam_wishlist', JSON.stringify([{ id: 'anon' }]))
    fetchMock.mockImplementation(() => new Promise(() => {})) // account list never arrives
    const { result, rerender } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.places.map(p => p.id)).toEqual(['anon']))
    auth.isAuthenticated = true
    rerender()
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(localStorage.getItem('roam_saved_cache')).toBeNull()
  })
})

describe('saved places: failed writes retry instead of rolling back', () => {
  it('the write is in the outbox while in flight (a reload or refresh mid-request keeps it)', async () => {
    const { result } = await mountSaved()
    let finish
    fetchMock.mockImplementationOnce(() => new Promise(r => { finish = r }))
    let done
    act(() => { done = result.current.savePlace({ id: 'c' }) })
    await waitFor(() => expect(outbox().map(e => e.key)).toEqual(['saved:c']))
    // a list refresh landing now keeps the in-flight save
    await act(async () => { await result.current.refresh() })
    expect(result.current.places.map(p => p.id)).toContain('c')
    await act(async () => { finish(new Response('{}', { status: 200 })); await done })
    expect(outbox()).toEqual([])
  })

  it('a write that keeps failing is given up after 20 flushes', async () => {
    writeStatus = 503
    const { result } = await mountSaved()
    await act(async () => { await result.current.savePlace({ id: 'c' }) })
    for (let i = 0; i < 19; i++) await flushOutbox()
    expect(outbox()).toHaveLength(1)
    await flushOutbox()
    expect(outbox()).toEqual([])
  })

  it.each([[503], ['offline']])('save on %s: kept on screen, queued, no happy moment yet', async status => {
    writeStatus = status
    const { result } = await mountSaved()
    let res
    await act(async () => { res = await result.current.savePlace({ id: 'c', name: 'C' }) })
    expect(res).toMatchObject({ success: false, queued: true, fallback: true }) // Discover shows no error toast
    expect(result.current.places.map(p => p.id)).toEqual(['c', 'a'])
    expect(outbox().map(e => [e.key, e.method])).toEqual([['saved:c', 'POST']])
    expect(recordHappyMoment).not.toHaveBeenCalled()
  })

  it('the queued save is sent on the next flush and leaves the queue', async () => {
    writeStatus = 'offline'
    const { result } = await mountSaved()
    await act(async () => { await result.current.savePlace({ id: 'c', name: 'C' }) })
    writeStatus = 200
    expect(await flushOutbox()).toBe(1)
    expect(outbox()).toEqual([])
    const sent = fetchMock.mock.calls.filter(([, o]) => o?.method === 'POST').at(-1)
    expect(JSON.parse(sent[1].body).place.id).toBe('c')
    expect(new Headers(sent[1].headers).get('Authorization')).toBe('Bearer tok')
  })

  it('a flush that hits another 503 keeps it; a final 4xx drops it', async () => {
    writeStatus = 503
    const { result } = await mountSaved()
    await act(async () => { await result.current.savePlace({ id: 'c' }) })
    await flushOutbox()
    expect(outbox()).toHaveLength(1)
    writeStatus = 403
    await flushOutbox()
    expect(outbox()).toEqual([])
  })

  it('a background refresh does not drop a save the server has not received', async () => {
    writeStatus = 'offline'
    const { result } = await mountSaved()
    await act(async () => { await result.current.savePlace({ id: 'c', name: 'C' }) })
    await act(async () => { await result.current.refresh() })
    expect(result.current.places.map(p => p.id)).toEqual(['c', 'a'])
  })

  it('save then unsave while offline queues only the unsave', async () => {
    writeStatus = 'offline'
    const { result } = await mountSaved()
    await act(async () => { await result.current.savePlace({ id: 'c' }) })
    await act(async () => { await result.current.removePlace('c') })
    expect(outbox().map(e => [e.key, e.method])).toEqual([['saved:c', 'DELETE']])
    expect(result.current.places.map(p => p.id)).toEqual(['a'])
  })

  it('unsave on 503 stays removed and is queued', async () => {
    writeStatus = 503
    const { result } = await mountSaved()
    await act(async () => { await result.current.removePlace('a') })
    expect(result.current.places).toEqual([])
    expect(pending('saved:').map(e => e.method)).toEqual(['DELETE'])
  })

  it('a later successful write for the same place clears its stale queued one', async () => {
    writeStatus = 'offline'
    const { result } = await mountSaved()
    await act(async () => { await result.current.savePlace({ id: 'c' }) })
    writeStatus = 200
    await act(async () => { await result.current.savePlace({ id: 'c', note: 'again' }) })
    expect(outbox()).toEqual([])
  })
})

describe('visits: failed writes retry', () => {
  it('a visit marked offline is kept, queued, and sent on flush', async () => {
    writeStatus = 'offline'
    const { result } = renderHook(() => useVisitedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.markVisited({ id: 'p1', name: 'P' }, 5) })
    expect(result.current.visitedPlaces.map(v => v.placeId)).toEqual(['p1'])
    expect(outbox().map(e => [e.key, e.method])).toEqual([['visited:p1', 'POST']])
    expect(recordHappyMoment).toHaveBeenCalledWith('visit_marked') // unchanged: a local visit is the moment

    // A refresh before the retry keeps it
    await act(async () => { await result.current.refresh() })
    expect(result.current.visitedPlaces.map(v => v.placeId)).toEqual(['p1'])

    writeStatus = 200
    expect(await flushOutbox()).toBe(1)
    const sent = fetchMock.mock.calls.filter(([, o]) => o?.method === 'POST').at(-1)
    expect(JSON.parse(sent[1].body)).toMatchObject({ placeId: 'p1', rating: 5 })
  })

  it('a visit on 500 is queued (it used to be dropped silently)', async () => {
    writeStatus = 500
    const { result } = renderHook(() => useVisitedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.markVisited({ id: 'p2' }) })
    expect(outbox().map(e => e.key)).toEqual(['visited:p2'])
  })

  it('a signed-in user with cached visits is not left loading while the network is slow', async () => {
    localStorage.setItem('roam_visited_places', JSON.stringify([{ placeId: 'old' }]))
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useVisitedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.visitedPlaces.map(v => v.placeId)).toEqual(['old'])
  })
})

describe('saved cache follows "keep me signed in"', () => {
  it('remember off: the saved list is cached in sessionStorage only', async () => {
    localStorage.removeItem('roam_auth_token')
    sessionStorage.setItem('roam_auth_token_session', 'stok')
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.places.map(p => p.id)).toEqual(['a']))
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('roam_saved_cache')).map(p => p.id)).toEqual(['a']))
    expect(localStorage.getItem('roam_saved_cache')).toBeNull()
  })
})

describe('a refresh that predates a write does not undo it on screen', () => {
  it('save completes while the initial load is in flight: the place stays', async () => {
    localStorage.setItem('roam_saved_cache', JSON.stringify([{ id: 'a' }]))
    let answerGet
    fetchMock.mockImplementation(async (url, opts = {}) => opts.method
      ? new Response('{}', { status: 200 })
      : new Promise(r => { answerGet = () => r(new Response(JSON.stringify({ places: [{ id: 'a' }] }), { status: 200 })) }))
    const { result } = renderHook(() => useSavedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false)) // from the cache
    await act(async () => { await result.current.savePlace({ id: 'c' }) }) // ok, leaves the outbox
    await act(async () => { answerGet() }) // server read happened before the save
    await waitFor(() => expect(result.current.places.map(p => p.id)).toEqual(['c', 'a']))
  })

  it('visit completes while the load is in flight: the visit stays', async () => {
    localStorage.setItem('roam_visited_places', JSON.stringify([{ placeId: 'old' }]))
    let answerGet
    fetchMock.mockImplementation(async (url, opts = {}) => opts.method
      ? new Response('{}', { status: 200 })
      : new Promise(r => { answerGet = () => r(new Response(JSON.stringify({ visited: [{ placeId: 'old' }] }), { status: 200 })) }))
    const { result } = renderHook(() => useVisitedPlaces())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.markVisited({ id: 'p9' }) })
    await act(async () => { answerGet() })
    await waitFor(() => expect(result.current.visitedPlaces.map(v => v.placeId)).toEqual(['p9', 'old']))
    expect(JSON.parse(localStorage.getItem('roam_visited_places')).map(v => v.placeId)).toEqual(['p9', 'old'])
  })
})
