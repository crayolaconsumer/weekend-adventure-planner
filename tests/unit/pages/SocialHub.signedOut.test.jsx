import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = { isAuthenticated: false, user: null, loading: false }
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../../src/hooks/useSocial', () => ({
  useUserSearch: () => ({ results: [], loading: false, search: vi.fn(), clearResults: vi.fn() }),
  useDiscoverUsers: () => ({ users: [], loading: false, error: null, refresh: vi.fn() })
}))
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => ({ info: vi.fn() }) }))
vi.mock('../../../src/utils/apiClient', () => ({ reverseGeocodeLocality: vi.fn(async () => null) }))
vi.mock('../../../src/components/LocationAwareFeed', () => ({ default: () => <div>friend feed</div> }))
vi.mock('../../../src/components/TrendingPlaces', () => ({ default: () => null }))

const { default: SocialHub } = await import('../../../src/pages/SocialHub.jsx')

describe('SocialHub signed out', () => {
  beforeEach(() => {
    auth.isAuthenticated = false
    auth.user = null
  })

  it('explains the tab and offers sign in and create account', () => {
    const geo = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: geo }, configurable: true })
    render(<MemoryRouter><SocialHub /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Sign in to see the social tab' })).toBeInTheDocument()
    expect(screen.getByText(/saves, plans and activity/)).toBeInTheDocument()
    const signIn = screen.getByRole('button', { name: 'Sign in' })
    const create = screen.getByRole('button', { name: 'Create account' })
    expect(signIn.className).toBe('btn btn-primary')
    expect(create.className).toBe('btn btn-secondary')
    expect(screen.queryByText('friend feed')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(geo).not.toHaveBeenCalled()
  })

  it('opens the auth modal in the right mode', () => {
    const seen = []
    const onOpen = e => seen.push(e.detail.mode)
    window.addEventListener('openAuthModal', onOpen)
    render(<MemoryRouter><SocialHub /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    window.removeEventListener('openAuthModal', onOpen)
    expect(seen).toEqual(['login', 'register'])
  })

  it('shows the feed, not the prompt, once signed in', () => {
    auth.isAuthenticated = true
    auth.user = { id: 1, username: 'sam' }
    render(<MemoryRouter><SocialHub location={{ lat: 51.5, lng: -0.1 }} /></MemoryRouter>)
    expect(screen.queryByText('Sign in to see the social tab')).toBeNull()
    expect(screen.getByText('friend feed')).toBeInTheDocument()
  })
})
