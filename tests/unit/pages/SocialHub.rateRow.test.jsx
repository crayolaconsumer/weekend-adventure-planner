import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Signed-out users never see Settings, so the Social tab's signed-out screen carries
// the same no-gating "Rate ROAM" path (native only)
let native = true
let platform = 'ios'
const openStoreReview = vi.fn()
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false, user: null, loading: false }) }))
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }) }))
vi.mock('../../../src/hooks/useSocial', () => ({ useUserSearch: () => ({}), useDiscoverUsers: () => ({}) }))
vi.mock('../../../src/components/LocationAwareFeed', () => ({ default: () => null }))
vi.mock('../../../src/components/TrendingPlaces', () => ({ default: () => null }))
vi.mock('../../../src/utils/apiClient', () => ({ reverseGeocodeLocality: async () => null }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => native, getPlatform: () => platform }))
vi.mock('../../../src/utils/navigation', () => ({ openStoreReview: p => openStoreReview(p) }))

const { default: SocialHub } = await import('../../../src/pages/SocialHub.jsx')
const renderHub = () => render(<MemoryRouter><SocialHub /></MemoryRouter>)

describe('SocialHub signed out: Rate ROAM', () => {
  beforeEach(() => { openStoreReview.mockClear(); native = true; platform = 'ios' })

  it('native: shown to signed-out users, opens the store review for their platform', () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Rate ROAM' }))
    expect(openStoreReview).toHaveBeenCalledWith('ios')
  })

  it('web: hidden (nothing installed to rate)', () => {
    native = false
    renderHub()
    expect(screen.queryByRole('button', { name: 'Rate ROAM' })).toBeNull()
  })
})
