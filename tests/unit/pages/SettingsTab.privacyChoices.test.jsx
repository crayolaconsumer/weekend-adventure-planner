import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const env = { native: true, required: true }
const showPrivacyOptions = vi.fn()
vi.mock('../../../src/utils/adMob', () => ({
  isPrivacyOptionsRequired: () => Promise.resolve(env.required),
  showPrivacyOptions: () => showPrivacyOptions(),
}))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => env.native, getPlatform: () => 'ios' }))
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
const { resetPrivacyChoicesCache } = await import('../../../src/hooks/usePrivacyChoices')

const renderTab = () => render(
  <MemoryRouter><SettingsTab user={{ username: 'sam', displayName: 'Sam' }} onLogout={() => {}} /></MemoryRouter>
)

describe('SettingsTab privacy choices', () => {
  beforeEach(() => {
    Object.assign(env, { native: true, required: true })
    resetPrivacyChoicesCache()
    showPrivacyOptions.mockReset().mockResolvedValue()
  })

  it('offers "Privacy choices" on native when UMP requires it, and opens the form', async () => {
    renderTab()
    const row = await screen.findByRole('button', { name: 'Privacy choices' })
    fireEvent.click(row)
    expect(showPrivacyOptions).toHaveBeenCalledTimes(1)
  })

  it('hidden when UMP says it is not required', async () => {
    env.required = false
    renderTab()
    await waitFor(() => expect(screen.getByText('Privacy Policy')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Privacy choices' })).toBeNull()
  })

  it('hidden on web', async () => {
    env.native = false
    renderTab()
    await waitFor(() => expect(screen.getByText('Privacy Policy')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Privacy choices' })).toBeNull()
  })
})
