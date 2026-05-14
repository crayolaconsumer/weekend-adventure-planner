import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// AuthContext is module-private — only AuthProvider + useAuth are exported.
// Mock useAuth directly rather than reaching past the export boundary.
vi.mock('../../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 99, username: 'me' },
    isAuthenticated: true,
    loading: false,
  }),
  AuthProvider: ({ children }) => children,
}))

const { default: FollowButton } = await import('../../../src/components/FollowButton')

function renderWithAuth(ui) {
  return render(ui)
}

beforeEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = vi.fn()
  // FollowButton reads token from localStorage to build Auth headers —
  // give it a value so it doesn't 401 out before the mock fetch runs.
  localStorage.setItem('roam_auth_token', 'test-token')
})

describe('FollowButton — private target (the screenshot bug)', () => {
  it('renders "Request" label when isPrivateAccount=true and not yet followed', () => {
    renderWithAuth(
      <FollowButton userId={42} isPrivateAccount initialFollowStatus="not_following" />
    )
    expect(screen.getByRole('button', { name: /request/i })).toBeInTheDocument()
    expect(screen.queryByText(/^following$/i)).not.toBeInTheDocument()
  })

  it('switches to "Requested" after click — never flashes "Following"', async () => {
    // Server responds slowly to make the optimistic state observable.
    let resolveFetch
    globalThis.fetch.mockReturnValue(new Promise((r) => { resolveFetch = r }))

    renderWithAuth(
      <FollowButton userId={42} isPrivateAccount initialFollowStatus="not_following" />
    )

    const buttonBefore = screen.getByRole('button', { name: /request/i })
    fireEvent.click(buttonBefore)

    // While the fetch is in flight the button shows a spinner instead of
    // its label, but the className still carries the optimistic state.
    // The crucial check: it must be `requested`, NOT `following`. That's
    // the bug from the screenshot — tapping Request on a private account
    // immediately rendered "Following" + unlocked content.
    await waitFor(() => {
      const btn = screen.getByRole('button')
      expect(btn.className).toMatch(/\brequested\b/)
      expect(btn.className).not.toMatch(/\bfollowing\b/)
    })

    resolveFetch({
      ok: true,
      json: async () => ({ success: true, status: 'requested' }),
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /requested/i })).toBeInTheDocument()
    })
  })

  it('reverts to "Request" if the server rejects the call', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'rate_limited' }),
    })

    renderWithAuth(
      <FollowButton userId={42} isPrivateAccount initialFollowStatus="not_following" />
    )

    fireEvent.click(screen.getByRole('button', { name: /request/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /request/i })).toBeInTheDocument()
    })
    // Must NOT have settled on Following — a failed Request on a private
    // account should reset, not silently complete.
    expect(screen.queryByText(/^following$/i)).not.toBeInTheDocument()
  })
})

describe('FollowButton — public target', () => {
  it('renders "Follow" label when isPrivateAccount=false', () => {
    renderWithAuth(
      <FollowButton userId={42} isPrivateAccount={false} initialFollowStatus="not_following" />
    )
    expect(screen.getByRole('button', { name: /^follow$/i })).toBeInTheDocument()
  })

  it('transitions to "Following" on success', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, status: 'following', followerCount: 1 }),
    })

    renderWithAuth(
      <FollowButton userId={42} isPrivateAccount={false} initialFollowStatus="not_following" />
    )

    fireEvent.click(screen.getByRole('button', { name: /^follow$/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /following/i })).toBeInTheDocument()
    })
  })
})

describe('FollowButton — server status overrides optimistic guess', () => {
  it('uses server-returned status even if it disagrees with isPrivateAccount prop', async () => {
    // E.g. the user becomes public between page load and click — the
    // button optimistically went 'requested', but the server can still
    // honor it and return 'following'. Source of truth = server.
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, status: 'following', followerCount: 1 }),
    })

    renderWithAuth(
      <FollowButton userId={42} isPrivateAccount initialFollowStatus="not_following" />
    )

    fireEvent.click(screen.getByRole('button', { name: /request/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /following/i })).toBeInTheDocument()
    })
  })
})
