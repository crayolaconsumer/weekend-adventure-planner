import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// Regression: "it keeps signing people out". A server hiccup must not sign
// anyone out, a real 401 must, and a renewed token must be stored.

const logoutFromRC = vi.fn()
vi.mock('../../../src/utils/errorReporting', () => ({ identifyUser: vi.fn(), clearUser: vi.fn() }))
vi.mock('../../../src/utils/analytics', () => ({ identify: vi.fn(), resetAnalytics: vi.fn(), track: vi.fn() }))
vi.mock('../../../src/utils/revenueCat', () => ({ identifyUserToRC: vi.fn(), logoutFromRC: () => logoutFromRC() }))
vi.mock('../../../src/hooks/usePushNotifications', () => ({ bestEffortUnsubscribePushNotifications: vi.fn() }))

const { AuthProvider, useAuth } = await import('../../../src/contexts/AuthContext')
const { TOKEN_STORAGE_KEY } = await import('../../../src/utils/authToken')

function Probe() {
  const { user, loading } = useAuth()
  return <div data-testid="who">{loading ? 'loading' : (user ? user.username : 'signed-out')}</div>
}

const USER = { id: 1, username: 'sam' }
const respond = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body })

describe('AuthContext session handling', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    logoutFromRC.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the user signed in through a server hiccup on app resume', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => respond(200, { user: USER }))
      .mockImplementationOnce(() => respond(503, { error: 'busy' }))
      .mockImplementationOnce(() => Promise.reject(new TypeError('Load failed')))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('sam'))

    await act(async () => { window.dispatchEvent(new Event('roam-app-foreground')) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('sam'))

    await act(async () => { window.dispatchEvent(new Event('roam-app-foreground')) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('sam'))
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('tok')
    expect(logoutFromRC).not.toHaveBeenCalled()
  })

  it('signs out and drops the token on a real 401', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'dead')
    vi.stubGlobal('fetch', vi.fn(() => respond(401, { error: 'Not authenticated' })))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('signed-out'))
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('stores a renewed token from the server (sliding session)', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'old')
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: USER, token: 'new' })))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('sam'))
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('new')
  })

  it('with no token at all, a failed check shows signed out', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(503, {})))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('signed-out'))
  })
})

describe('RevenueCat logout only on a real sign-out', () => {
  beforeEach(() => { localStorage.clear(); logoutFromRC.mockReset() })
  afterEach(() => vi.unstubAllGlobals())

  it('does not log out of RevenueCat on launch before the auth check lands (regression: premium flicker)', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { user: USER })))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('sam'))
    expect(logoutFromRC).not.toHaveBeenCalled()
  })

  it('does log out of RevenueCat when a signed-in token turns out dead', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => respond(200, { user: USER }))
      .mockImplementationOnce(() => respond(401, {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('sam'))
    await act(async () => { window.dispatchEvent(new Event('roam-app-foreground')) })
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('signed-out'))
    expect(logoutFromRC).toHaveBeenCalledTimes(1)
  })
})

describe('pre-signup saves migration', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())

  function LoginButton() {
    const { login } = useAuth()
    return <button onClick={() => login('a@b.co', 'pw', true)}>go</button>
  }

  const loginWithMigrate = async (migrateBody, migrateOk = true) => {
    localStorage.setItem('roam_wishlist', JSON.stringify([{ id: 'a' }, { id: 'b' }]))
    const fetchMock = vi.fn((url, opts) => {
      if (String(url).includes('migrate')) {
        return Promise.resolve({ ok: migrateOk, status: migrateOk ? 200 : 413, json: async () => migrateBody })
      }
      if (opts?.method === 'POST') return respond(200, { user: USER, token: 'tok' })
      return respond(401, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthProvider><LoginButton /></AuthProvider>)
    await act(async () => { screen.getByText('go').click() })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('migrate'))).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  }

  it('clears local saves once every place is on the server', async () => {
    await loginWithMigrate({ success: true, migrated: 2, failed: 0 })
    expect(localStorage.getItem('roam_wishlist')).toBeNull()
  })

  it('keeps local saves when any failed to import (regression: data loss)', async () => {
    await loginWithMigrate({ success: false, migrated: 1, failed: 1 })
    expect(localStorage.getItem('roam_wishlist')).not.toBeNull()
  })

  it('sends more than 500 saves in chunks so a big list is never stuck (regression)', async () => {
    const many = Array.from({ length: 1100 }, (_, i) => ({ id: `p${i}` }))
    localStorage.setItem('roam_wishlist', JSON.stringify(many))
    const sizes = []
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      if (String(url).includes('migrate')) {
        sizes.push(JSON.parse(opts.body).places.length)
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, failed: 0, capped: 0 }) })
      }
      if (opts?.method === 'POST') return respond(200, { user: USER, token: 'tok' })
      return respond(401, {})
    }))
    render(<AuthProvider><LoginButton /></AuthProvider>)
    await act(async () => { screen.getByText('go').click() })
    await waitFor(() => expect(sizes).toEqual([500, 500, 100]))
    await waitFor(() => expect(localStorage.getItem('roam_wishlist')).toBeNull())
  })

  it('over the free cap: keeps the local copy and retries next sign-in (arrives after upgrading)', async () => {
    await loginWithMigrate({ success: false, migrated: 10, failed: 0, capped: 5 })
    expect(localStorage.getItem('roam_wishlist')).not.toBeNull()
    expect(localStorage.getItem('roam_places_migrated_1')).toBeNull()
  })

  it('never deletes corrupt (non-array) local data', async () => {
    await loginWithMigrate({ success: true, failed: 0 })
    localStorage.clear()
    localStorage.setItem('roam_wishlist', '{"not":"an array"}')
    vi.stubGlobal('fetch', vi.fn((url, opts) => opts?.method === 'POST' && !String(url).includes('migrate')
      ? respond(200, { user: USER, token: 'tok' }) : respond(401, {})))
    render(<AuthProvider><LoginButton /></AuthProvider>)
    await act(async () => { screen.getAllByText('go').at(-1).click() })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(localStorage.getItem('roam_wishlist')).toBe('{"not":"an array"}')
  })

  it('keeps local saves when the server rejects the import', async () => {
    await loginWithMigrate({ error: 'Too many' }, false)
    expect(localStorage.getItem('roam_wishlist')).not.toBeNull()
  })
})

describe('sign-out on a shared device', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('drops the half-built plan so it does not follow the next person', async () => {
    localStorage.setItem('roam_plan_draft', JSON.stringify({ itinerary: [{ id: 1 }], savedAt: Date.now() }))
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    vi.stubGlobal('fetch', vi.fn((url, opts) => opts?.method === 'POST' ? respond(200, {}) : respond(200, { user: USER })))
    function Out() { const { logout } = useAuth(); return <button onClick={() => logout()}>out</button> }
    render(<AuthProvider><Out /></AuthProvider>)
    await act(async () => { screen.getByText('out').click() })
    await waitFor(() => expect(localStorage.getItem('roam_plan_draft')).toBeNull())
  })
})
