import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const env = { native: true, platform: 'android' }
const openExternalLink = vi.fn()
vi.mock('../../../src/utils/adMob', () => ({ isPrivacyOptionsRequired: () => Promise.resolve(false), showPrivacyOptions: vi.fn() }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => env.native, getPlatform: () => env.platform }))
const openStoreReview = vi.fn()
vi.mock('../../../src/utils/navigation', () => ({ openExternalLink: (u) => openExternalLink(u), openStoreReview: (p) => openStoreReview(p) }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ updateProfile: vi.fn(), deleteAccount: vi.fn() }) }))
vi.mock('../../../src/contexts/ThemeContext', () => ({ useTheme: () => ({ preference: 'system', setPreference: vi.fn() }) }))
vi.mock('../../../src/contexts/DistanceContext', () => ({
  useDistance: () => ({ distanceUnit: 'km', setDistanceUnit: vi.fn(), formatDistance: (m) => `${m} m` }),
}))
vi.mock('../../../src/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: false, manageSubscription: vi.fn() }) }))
vi.mock('../../../src/components/OfflinePackCard', () => ({ default: () => null }))
vi.mock('../../../src/components/PrivacySettings', () => ({ default: () => null }))
vi.mock('../../../src/pages/UnifiedProfile/NotificationsSection', () => ({ default: () => null }))

const { default: SettingsTab } = await import('../../../src/pages/UnifiedProfile/SettingsTab')

const renderTab = () => render(
  <MemoryRouter><SettingsTab user={{ username: 'sam', displayName: 'Sam' }} onLogout={() => {}} /></MemoryRouter>
)

describe('SettingsTab "Rate ROAM" row', () => {
  beforeEach(() => { openExternalLink.mockClear(); openStoreReview.mockClear() })

  it('Android opens the Play listing', () => {
    Object.assign(env, { native: true, platform: 'android' })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Rate ROAM' }))
    expect(openStoreReview).toHaveBeenCalledWith('android')
  })

  it('iOS opens the App Store write-review page', () => {
    Object.assign(env, { native: true, platform: 'ios' })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Rate ROAM' }))
    expect(openStoreReview).toHaveBeenCalledWith('ios')
  })

  it('hidden on web', async () => {
    Object.assign(env, { native: false, platform: 'web' })
    renderTab()
    await waitFor(() => expect(screen.getByText('Privacy Policy')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Rate ROAM' })).toBeNull()
  })
})
