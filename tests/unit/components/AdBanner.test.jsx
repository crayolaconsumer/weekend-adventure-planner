import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const injectAdSenseScript = vi.fn()
const env = { slot: null, premium: false, authLoading: false }
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => false }))
vi.mock('../../../src/contexts/AuthContext', () => ({ useAuth: () => ({ loading: env.authLoading }) }))
vi.mock('../../../src/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: env.premium, noAds: env.premium }) }))
vi.mock('../../../src/utils/adSense', () => ({
  isAdSenseConfigured: () => true,
  getAdSenseClientId: () => 'ca-pub-1',
  get ADSENSE_SLOT_BANNER() { return env.slot },
  injectAdSenseScript: () => injectAdSenseScript(),
  pushAdSlot: () => {},
}))

const { default: AdBanner } = await import('../../../src/components/AdBanner')

describe('AdBanner', () => {
  beforeEach(() => {
    injectAdSenseScript.mockReset()
    Object.assign(env, { slot: null, premium: false, authLoading: false })
  })

  it('never loads the AdSense script without a slot to fill (regression: Auto ads on empty screens got the site rejected)', () => {
    render(<AdBanner />)
    expect(injectAdSenseScript).not.toHaveBeenCalled()
  })

  it('loads it for free users once a banner slot is configured', () => {
    env.slot = '123'
    render(<AdBanner />)
    expect(injectAdSenseScript).toHaveBeenCalledTimes(1)
  })

  it('never loads it for premium users or while auth is loading', () => {
    env.slot = '123'
    env.premium = true
    render(<AdBanner />)
    env.premium = false
    env.authLoading = true
    render(<AdBanner />)
    expect(injectAdSenseScript).not.toHaveBeenCalled()
  })
})
