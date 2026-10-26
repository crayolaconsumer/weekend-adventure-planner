import { it, expect, vi } from 'vitest'

// Regression (issue #1, 26 Oct 2026): the iOS/Android apps sent PostHog nothing.
// CapacitorHttp (capacitor.config.json) patches window.fetch, and its bridge can only
// carry string / Uint8Array / FormData bodies. posthog-js gzips every batch into an
// ArrayBuffer, which crosses the bridge as {} and dies in native with
// CapacitorUrlRequestError.serializationError. Native must send plain-string JSON.
// Real posthog-js on purpose: this must fail if a posthog-js upgrade changes the body.
vi.mock('../../../src/utils/whenIdle', () => ({ whenIdle: cb => cb() }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => true, getPlatform: () => 'ios' }))
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '0', build: '0' }) } }))

it('native: PostHog sends a plain JSON string body the CapacitorHttp bridge can carry', async () => {
  const fetch = vi.fn(async () => new Response('{"status":1}', { status: 200 }))
  vi.stubGlobal('fetch', fetch) // posthog-js captures window.fetch when its module loads
  // happy-dom reports webdriver=true, which posthog-js treats as a bot and drops
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true })
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
  vi.stubEnv('VITE_POSTHOG_DEV', '1') // vitest runs with DEV=true, which opts out
  const { initAnalytics, track } = await import('../../../src/utils/analytics.js')
  await initAnalytics()
  track('transport-test')

  const ingest = () => fetch.mock.calls.filter(([url]) => String(url).includes('/e/'))
  await vi.waitFor(() => expect(ingest().some(([, init]) => String(init.body).includes('transport-test'))).toBe(true),
    { timeout: 8000, interval: 100 })
  for (const [url, init] of ingest()) {
    expect(typeof init.body).toBe('string')
    expect(String(url)).not.toContain('compression=gzip-js')
    JSON.parse(init.body) // valid JSON, as sent by the native layer
  }
}, 15000)
