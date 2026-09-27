import { describe, it, expect, vi, beforeEach } from 'vitest'

const Sentry = {
  init: vi.fn(), captureException: vi.fn(), setUser: vi.fn(),
  browserTracingIntegration: vi.fn(), replayIntegration: vi.fn(),
}
vi.mock('@sentry/react', () => Sentry)

describe('errorReporting', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers() })

  it('loads Sentry after first paint and delivers errors reported before it arrived', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o.ingest.sentry.io/1')
    const { initObservability, reportError, identifyUser } = await import('../../../src/utils/errorReporting')
    initObservability()
    reportError(new Error('early'), { where: 'boot' })
    identifyUser({ id: 7 })
    await vi.dynamicImportSettled()
    expect(Sentry.init).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    vi.useRealTimers()
    await vi.waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1))
    expect(Sentry.init).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException.mock.calls[0][0].message).toBe('early')
    expect(Sentry.captureException.mock.calls[0][1].extra.where).toBe('boot')
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: '7', username: undefined, email: undefined })
    vi.unstubAllEnvs()
  })

  it('sends uncaught errors thrown before Sentry loaded (startup crashes)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o.ingest.sentry.io/1')
    const { initObservability } = await import('../../../src/utils/errorReporting')
    initObservability()
    const boom = new Error('startup crash')
    window.dispatchEvent(new ErrorEvent('error', { error: boom, message: boom.message }))
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    await vi.waitFor(() => expect(Sentry.captureException).toHaveBeenCalledWith(boom))
    vi.unstubAllEnvs()
  })

  it('never loads Sentry without a DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { initObservability, reportError } = await import('../../../src/utils/errorReporting')
    initObservability()
    reportError(new Error('x'))
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    expect(Sentry.init).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
