import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// Issue #23: local-first startup. Guests never call /api/auth; signed-in users
// render from the device cache at once and /api/auth revalidates behind them.

vi.mock('../../../src/utils/errorReporting', () => ({ identifyUser: vi.fn(), clearUser: vi.fn() }))
vi.mock('../../../src/utils/analytics', () => ({ identify: vi.fn(), resetAnalytics: vi.fn(), track: vi.fn() }))
vi.mock('../../../src/utils/revenueCat', () => ({ identifyUserToRC: vi.fn(), logoutFromRC: vi.fn() }))
vi.mock('../../../src/hooks/usePushNotifications', () => ({ bestEffortUnsubscribePushNotifications: vi.fn() }))

const { AuthProvider, useAuth } = await import('../../../src/contexts/AuthContext')
const { TOKEN_STORAGE_KEY } = await import('../../../src/utils/authToken')

const USER = { id: 1, username: 'sam' }
const FRESH = { id: 1, username: 'sam-renamed' }
const respond = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body })
const authCalls = fetchMock => fetchMock.mock.calls.filter(([u, o]) => u === '/api/auth' && !o?.method)

function Probe() {
  const { user, loading } = useAuth()
  return <div data-testid="who">{loading ? 'loading' : (user ? user.username : 'signed-out')}</div>
}
const who = () => screen.getByTestId('who').textContent

function signedInDevice() {
  localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
  localStorage.setItem('roam_cached_user', JSON.stringify(USER))
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => vi.unstubAllGlobals())

describe('guest startup', () => {
  it('makes no /api/auth request and is signed out at once', async () => {
    const fetchMock = vi.fn(() => respond(401, {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(who()).toBe('signed-out') // first render: no loading state
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('app resume as a guest makes no request either', async () => {
    const fetchMock = vi.fn(() => respond(401, {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => { window.dispatchEvent(new Event('roam-app-foreground')) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(who()).toBe('signed-out')
  })
})

describe('signed-in startup', () => {
  it('renders the cached user before /api/auth answers, then takes the fresh one', async () => {
    signedInDevice()
    let answer
    const fetchMock = vi.fn(() => new Promise(r => { answer = r }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(who()).toBe('sam') // first paint, network still pending
    expect(authCalls(fetchMock)).toHaveLength(1) // revalidating in the background
    await act(async () => { answer({ ok: true, status: 200, json: async () => ({ user: FRESH }) }) })
    await waitFor(() => expect(who()).toBe('sam-renamed'))
    expect(JSON.parse(localStorage.getItem('roam_cached_user'))).toEqual(FRESH)
  })

  it('a cookie-only web session (no stored token) with a cached user still revalidates', async () => {
    localStorage.setItem('roam_cached_user', JSON.stringify(USER))
    const fetchMock = vi.fn(() => respond(200, { user: USER }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(who()).toBe('sam')
    expect(authCalls(fetchMock)[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('a token with no cache yet (first open after upgrade) waits for /api/auth as before', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: USER })))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(who()).toBe('loading')
    await waitFor(() => expect(who()).toBe('sam'))
    expect(JSON.parse(localStorage.getItem('roam_cached_user'))).toEqual(USER)
  })

  it('stays signed in on a server hiccup or offline start', async () => {
    signedInDevice()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Load failed'))))
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(who()).toBe('sam')
  })

  it('an invalid session on refresh signs out and wipes the device copies', async () => {
    signedInDevice()
    localStorage.setItem('roam_saved_cache', JSON.stringify([{ id: 'a' }]))
    localStorage.setItem('roam_visited_places', JSON.stringify([{ placeId: 'v' }]))
    localStorage.setItem('roam_outbox', JSON.stringify([{ key: 'saved:a', url: '/api/places/saved', method: 'POST', body: {} }]))
    vi.stubGlobal('fetch', vi.fn(() => respond(401, { error: 'Not authenticated' })))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(who()).toBe('sam')
    await waitFor(() => expect(who()).toBe('signed-out'))
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('roam_cached_user')).toBeNull()
    expect(localStorage.getItem('roam_saved_cache')).toBeNull()
    expect(localStorage.getItem('roam_visited_places')).toBeNull() // even with useVisitedPlaces unmounted
    expect(localStorage.getItem('roam_outbox')).toBeNull()
  })

  it('sign out wipes the cached user so the next open is a guest open', async () => {
    signedInDevice()
    vi.stubGlobal('fetch', vi.fn((u, o) => respond(200, o?.method ? {} : { user: USER })))
    function Out() { const { logout } = useAuth(); return <button onClick={() => logout()}>out</button> }
    render(<AuthProvider><Probe /><Out /></AuthProvider>)
    await act(async () => { screen.getByText('out').click() })
    await waitFor(() => expect(who()).toBe('signed-out'))
    expect(localStorage.getItem('roam_cached_user')).toBeNull()
  })

  it('a background check that lands after sign-out does not sign the user back in', async () => {
    signedInDevice()
    let answer
    vi.stubGlobal('fetch', vi.fn((u, o) => o?.method ? respond(200, {}) : new Promise(r => { answer = r })))
    function Out() { const { logout } = useAuth(); return <button onClick={() => logout()}>out</button> }
    render(<AuthProvider><Probe /><Out /></AuthProvider>)
    await act(async () => { screen.getByText('out').click() })
    await waitFor(() => expect(who()).toBe('signed-out'))
    await act(async () => { answer({ ok: true, status: 200, json: async () => ({ user: USER, token: 'renewed' }) }) })
    expect(who()).toBe('signed-out')
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('a check that starts while the logout request is in flight cannot sign the user back in', async () => {
    signedInDevice()
    let releaseLogout, releaseGet, booted = false
    vi.stubGlobal('fetch', vi.fn((url, o = {}) => {
      if (o.method === 'POST') return new Promise(r => { releaseLogout = () => r({ ok: true, status: 200, json: async () => ({}) }) })
      if (!booted) return respond(200, { user: USER })
      // logout doesn't revoke the JWT, so this check gets a 200 with a renewed token
      return new Promise(r => { releaseGet = () => r({ ok: true, status: 200, json: async () => ({ user: USER, token: 'renewed' }) }) })
    }))
    let api
    function Grab() { api = useAuth(); return null }
    render(<AuthProvider><Probe /><Grab /></AuthProvider>)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    booted = true
    let out
    await act(async () => { out = api.logout(); await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { window.dispatchEvent(new Event('roam-app-foreground')); await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { releaseLogout(); await out })
    await act(async () => { releaseGet(); await new Promise(r => setTimeout(r, 10)) })
    expect(who()).toBe('signed-out')
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('roam_cached_user')).toBeNull()
  })

  it('a resume revalidation does not flip loading (hooks gated on auth do not reload)', async () => {
    signedInDevice()
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: USER })))
    const seen = []
    function Track() { const { loading } = useAuth(); seen.push(loading); return null }
    render(<AuthProvider><Track /></AuthProvider>)
    await act(async () => { window.dispatchEvent(new Event('roam-app-foreground')) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(seen.every(l => l === false)).toBe(true)
  })
})

describe('write outbox retries', () => {
  const queued = [{ key: 'saved:a', url: '/api/places/saved', method: 'POST', body: { place: { id: 'a' } } }]

  it('a confirmed session sends writes that failed earlier', async () => {
    signedInDevice()
    localStorage.setItem('roam_outbox', JSON.stringify(queued))
    const fetchMock = vi.fn((u, o) => respond(200, o?.method ? {} : { user: USER }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(localStorage.getItem('roam_outbox')).toBeNull())
    const post = fetchMock.mock.calls.find(([u, o]) => u === '/api/places/saved' && o.method === 'POST')
    expect(new Headers(post[1].headers).get('Authorization')).toBe('Bearer tok')
    expect(JSON.parse(post[1].body)).toEqual({ place: { id: 'a' } })
  })

  it('coming back online sends them too', async () => {
    signedInDevice()
    const fetchMock = vi.fn((u, o) => respond(o?.method ? 200 : 503, {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    localStorage.setItem('roam_outbox', JSON.stringify(queued))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(localStorage.getItem('roam_outbox')).toBeNull())
  })
})

describe('device copies follow "keep me signed in"', () => {
  it('remember off (session token): cached user stays in sessionStorage, ending with the browser session', async () => {
    sessionStorage.setItem('roam_auth_token_session', 'stok')
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: USER })))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(who()).toBe('sam'))
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('roam_cached_user'))).toEqual(USER))
    expect(localStorage.getItem('roam_cached_user')).toBeNull()
  })

  it('remember on: cached user in localStorage (survives a restart)', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: USER })))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(JSON.parse(localStorage.getItem('roam_cached_user'))).toEqual(USER))
    expect(sessionStorage.getItem('roam_cached_user')).toBeNull()
  })

  it('a session-stored cached user still renders at once in its own tab', async () => {
    sessionStorage.setItem('roam_auth_token_session', 'stok')
    sessionStorage.setItem('roam_cached_user', JSON.stringify(USER))
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(who()).toBe('sam')
  })
})

describe('viewer-filtered memo caches', () => {
  it('sign-out drops the card-tip memo, so the next person refetches', async () => {
    const { fetchBatchContributions } = await import('../../../src/hooks/useTopContributions')
    signedInDevice()
    const fetchMock = vi.fn((url, o) => {
      if (String(url).startsWith('/api/contributions/batch')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ contributions: { 'node/9': { id: 1, content: 'followers-only tip' } } }) })
      return respond(200, o?.method ? {} : { user: USER })
    })
    vi.stubGlobal('fetch', fetchMock)
    function Out() { const { logout } = useAuth(); return <button onClick={() => logout()}>out</button> }
    render(<AuthProvider><Probe /><Out /></AuthProvider>)
    await fetchBatchContributions(['node/9'])
    await fetchBatchContributions(['node/9']) // memoised: one request
    const batchCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/contributions/batch')).length
    expect(batchCalls()).toBe(1)
    await act(async () => { screen.getByText('out').click() })
    await waitFor(() => expect(who()).toBe('signed-out'))
    await fetchBatchContributions(['node/9'])
    expect(batchCalls()).toBe(2)
  })
})
