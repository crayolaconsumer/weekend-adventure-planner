import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression (26 Oct 2026): app and web events were indistinguishable in PostHog, though the
// apps are the product. Every event now carries platform/surface (and app version on native).
const ph = { init: vi.fn(), register: vi.fn(), capture: vi.fn(), opt_out_capturing: vi.fn() }
vi.mock('posthog-js', () => ({ default: ph }))
vi.mock('../../../src/utils/whenIdle', () => ({ whenIdle: cb => cb() }))
const native = { on: false, platform: 'web' }
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => native.on, getPlatform: () => native.platform }))
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.3.18', build: '84' }) } }))

async function load() {
  vi.resetModules()
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
  return import('../../../src/utils/analytics.js')
}

describe('analytics platform tagging', () => {
  beforeEach(() => { ph.register.mockClear() })

  it('tags web events as web', async () => {
    Object.assign(native, { on: false, platform: 'web' })
    const { initAnalytics } = await load()
    await initAnalytics()
    expect(ph.register).toHaveBeenCalledWith({ platform: 'web', surface: 'web' })
    expect(ph.register).toHaveBeenCalledTimes(1)
  })

  it('tags app events with the platform and the app version', async () => {
    Object.assign(native, { on: true, platform: 'ios' })
    const { initAnalytics } = await load()
    await initAnalytics()
    expect(ph.register).toHaveBeenCalledWith({ platform: 'ios', surface: 'app' })
    await vi.waitFor(() => expect(ph.register).toHaveBeenCalledWith({ app_version: '1.3.18', app_build: '84' }))
  })
})
