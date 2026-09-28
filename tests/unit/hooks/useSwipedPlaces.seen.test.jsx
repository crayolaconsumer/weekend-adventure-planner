/**
 * Discover deck freshness, rubric points 3, 4 and 7 (server side of it):
 * the seen store follows the signed-in user, signed-in users merge the
 * server's swipes once per user per session, and a failing GET never breaks
 * anything. (Swipes are written by Discover's handler: Discover.freshness test.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const auth = { isAuthenticated: false, loading: false, user: null }
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../../src/utils/authToken', () => ({ getAuthToken: () => 'tok' }))

const { useSwipedPlaces, resetServerSeenForTests } = await import('../../../src/hooks/useSwipedPlaces')
const { excludeSeen, recordSeen, resetSeenCache } = await import('../../../src/utils/seenPlaces')

const DAY = 86400000
const kept = list => excludeSeen(list.map(id => ({ id }))).map(p => p.id)
const gets = () => fetch.mock.calls.filter(([, o = {}]) => !o.method || o.method === 'GET')
const posts = () => fetch.mock.calls.filter(([, o = {}]) => o.method === 'POST')
const signIn = id => Object.assign(auth, { isAuthenticated: true, user: { id } })
const signOut = () => Object.assign(auth, { isAuthenticated: false, user: null })
const settle = () => new Promise(r => setTimeout(r, 20))

let serverBody
beforeEach(() => {
  localStorage.clear()
  resetSeenCache()
  resetServerSeenForTests()
  signOut()
  serverBody = {
    likes: [{ placeId: 'phone-like', swipedAt: Date.now() - DAY }],
    skips: [{ placeId: 'phone-skip', swipedAt: Date.now() - 2 * DAY }],
  }
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => (opts.method === 'POST'
    ? new Response('{}', { status: 200 })
    : new Response(JSON.stringify(serverBody), { status: 200 }))))
})
afterEach(() => vi.unstubAllGlobals())

describe('signed out', () => {
  it('no network; skips still feed the taste-profile list', async () => {
    const { result } = renderHook(() => useSwipedPlaces())
    await act(async () => { await result.current.recordSwipe('a', 'skip', { categoryKey: 'food' }) })
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('roam_not_interested')).map(e => e.placeId)).toEqual(['a'])
  })
})

describe('3. cross-device (signed in)', () => {
  it('merges the server list with one GET per session and tells the deck', async () => {
    signIn(7)
    const onSeenChange = vi.fn()
    const { unmount } = renderHook(() => useSwipedPlaces({ onSeenChange }))
    await waitFor(() => expect(kept(['phone-like', 'phone-skip', 'new'])).toEqual(['new']))
    expect(onSeenChange).toHaveBeenCalled()
    expect(gets()).toHaveLength(1)
    expect(gets()[0][0]).toBe('/api/places/swiped?limit=500')
    expect(gets()[0][1].headers.Authorization).toBe('Bearer tok')

    // Discover re-mounts (tab change): no second GET this session
    unmount()
    renderHook(() => useSwipedPlaces({ onSeenChange }))
    await settle()
    expect(gets()).toHaveLength(1)
  })

  it('sign out, another user signs in: a fresh GET for them, and none of the first user\'s swipes', async () => {
    signIn(7)
    const { rerender } = renderHook(() => useSwipedPlaces())
    await waitFor(() => expect(kept(['phone-like'])).toEqual([]))
    recordSeen('seven-only', 'skip')
    signOut()
    rerender()
    await settle()
    expect(kept(['phone-like', 'seven-only'])).toEqual(['phone-like', 'seven-only'])
    serverBody = { likes: [], skips: [{ placeId: 'eight-skip', swipedAt: Date.now() }] }
    signIn(8)
    rerender()
    await waitFor(() => expect(gets()).toHaveLength(2))
    await waitFor(() => expect(kept(['eight-skip'])).toEqual([]))
    expect(kept(['phone-like', 'seven-only'])).toEqual(['phone-like', 'seven-only'])
  })

  it('user switches straight from A to B (no signed-out render): B still gets its own GET', async () => {
    signIn(7)
    const { rerender } = renderHook(() => useSwipedPlaces())
    await waitFor(() => expect(gets()).toHaveLength(1))
    serverBody = { likes: [], skips: [{ placeId: 'eight-skip', swipedAt: Date.now() }] }
    signIn(8)
    rerender()
    await waitFor(() => expect(gets()).toHaveLength(2))
    await waitFor(() => expect(kept(['eight-skip', 'phone-like'])).toEqual(['phone-like']))
  })

  it('nothing new from the server and no store switch: the deck is not rebuilt', async () => {
    signIn(7)
    serverBody = { likes: [], skips: [] }
    const onSeenChange = vi.fn()
    const { rerender } = renderHook(() => useSwipedPlaces({ onSeenChange }))
    await waitFor(() => expect(gets()).toHaveLength(1))
    await settle()
    onSeenChange.mockClear()
    rerender()
    await settle()
    expect(onSeenChange).not.toHaveBeenCalled()
  })

  it.each([
    ['500', () => new Response('{"error":"x"}', { status: 500 })],
    ['network error', () => { throw new TypeError('Failed to fetch') }],
    ['bad JSON', () => new Response('<html>', { status: 200 })],
    ['odd shape', () => new Response('{"likes":"nope","skips":null}', { status: 200 })],
  ])('7. server GET fails (%s): no throw, local swipes still excluded', async (_, respond) => {
    const { rerender } = renderHook(() => useSwipedPlaces())
    recordSeen('local', 'skip')
    fetch.mockImplementation(async (url, opts = {}) => (opts.method === 'POST' ? new Response('{}') : respond()))
    signIn(7)
    rerender()
    await waitFor(() => expect(gets()).toHaveLength(1))
    await settle()
    expect(kept(['local', 'other'])).toEqual(['other'])
  })
})

describe('4. signed out, then signed in', () => {
  it('local skips sync up (existing POST) and anonymous swipes still exclude after the merge', async () => {
    const { result, rerender } = renderHook(() => useSwipedPlaces())
    await act(async () => { await result.current.recordSwipe('anon-skip', 'skip') })
    recordSeen('anon-skip', 'skip')
    recordSeen('anon-like', 'like')
    signIn(7)
    rerender()
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(posts()[0][1].body)).toEqual({ swipes: [{ placeId: 'anon-skip', action: 'skip' }] })
    await waitFor(() => expect(gets()).toHaveLength(1))
    await settle()
    resetSeenCache({ keepOwner: true }) // reload
    expect(kept(['anon-skip', 'anon-like', 'phone-like', 'phone-skip', 'x'])).toEqual(['x'])
  })
})
