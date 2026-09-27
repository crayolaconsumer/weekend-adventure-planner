import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, checkAuth: vi.fn() }) }))
vi.mock('../../../src/hooks/useSubscription', () => ({
  useSubscription: () => ({ isPremium: false, startCheckout: vi.fn(), loading: false, error: null, subscriptionSource: null })
}))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => false, getPlatform: () => 'web' }))
vi.mock('../../../src/utils/nativePlugins', () => ({ openExternalUrl: vi.fn() }))
vi.mock('../../../src/utils/analytics', () => ({ track: vi.fn() }))
vi.mock('../../../src/utils/revenueCat', () => ({
  getOfferings: vi.fn(async () => null), purchasePackage: vi.fn(), restorePurchases: vi.fn(), checkTrialEligibility: vi.fn(async () => ({}))
}))

const { maxReachKm } = await import('../../../src/pages/Discover/distanceBands')
const { TRAVEL_MODES } = await import('../../../src/pages/Discover/constants')
const { default: Pricing } = await import('../../../src/pages/Pricing.jsx')
const { default: UpgradePrompt } = await import('../../../src/components/UpgradePrompt.jsx')

const inRouter = ui => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('real Discover reach per travel mode', () => {
  it('is the far edge of the longest band', () => {
    expect(['walking', 'transit', 'driving', 'dayTrip', 'explorer'].map(maxReachKm)).toEqual([5, 15, 30, 70, 110])
  })

  it('free modes top out at 30km (the furthest non-premium mode)', () => {
    const free = Object.keys(TRAVEL_MODES).filter(k => !TRAVEL_MODES[k].premium)
    expect(Math.max(...free.map(maxReachKm))).toBe(30)
  })
})

describe('free tier copy matches the limits', () => {
  it('Pricing shows the real saves cap and Discover reach', () => {
    inRouter(<Pricing />)
    expect(screen.getAllByText('Discover further afield').length).toBeGreaterThan(0)
    expect(screen.getByText('Up to 30km')).toBeInTheDocument()
    expect(screen.getByText('Up to 110km')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/150km/)
    expect(screen.getAllByText('Save places and events').length).toBeGreaterThan(0)
    expect(screen.getByText('10 each')).toBeInTheDocument()
  })

  it('the radius upgrade prompt promises what the bands deliver', () => {
    inRouter(<UpgradePrompt type="radius" isOpen onClose={() => {}} />)
    expect(screen.getByText(/Day trip \(up to 70km\) and Explorer \(up to 110km\)/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/150km|75km/)
  })
})
