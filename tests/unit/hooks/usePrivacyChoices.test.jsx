import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const env = { native: true, noAds: false, required: true }
const isPrivacyOptionsRequired = vi.fn()
const showPrivacyOptions = vi.fn()
vi.mock('../../../src/utils/adMob', () => ({
  isPrivacyOptionsRequired: () => isPrivacyOptionsRequired(),
  showPrivacyOptions: () => showPrivacyOptions(),
}))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => env.native }))
vi.mock('../../../src/hooks/useSubscription', () => ({ useSubscription: () => ({ noAds: env.noAds }) }))

const { usePrivacyChoices } = await import('../../../src/hooks/usePrivacyChoices')

describe('usePrivacyChoices', () => {
  beforeEach(() => {
    Object.assign(env, { native: true, noAds: false, required: true })
    isPrivacyOptionsRequired.mockReset().mockImplementation(() => Promise.resolve(env.required))
    showPrivacyOptions.mockReset().mockResolvedValue()
  })
  afterEach(() => { delete window.googlefc })

  it('native: required from UMP, open shows the privacy options form', async () => {
    const { result } = renderHook(() => usePrivacyChoices())
    await waitFor(() => expect(result.current.required).toBe(true))
    result.current.open()
    expect(showPrivacyOptions).toHaveBeenCalledTimes(1)
  })

  it('native: re-reads on mount, so an earlier false (consent unknown) is not stuck', async () => {
    env.required = false
    const a = renderHook(() => usePrivacyChoices())
    await act(async () => {})
    expect(a.result.current.required).toBe(false)
    a.unmount()
    env.required = true
    const b = renderHook(() => usePrivacyChoices())
    await waitFor(() => expect(b.result.current.required).toBe(true))
  })

  it('ad-free users: never asked, no consent lookup', async () => {
    env.noAds = true
    const { result } = renderHook(() => usePrivacyChoices())
    await act(async () => {})
    expect(result.current.required).toBe(false)
    expect(isPrivacyOptionsRequired).not.toHaveBeenCalled()
  })

  it('web: offered when AdSense consent messaging (googlefc) is present; open queues the revocation message', () => {
    env.native = false
    const showRevocationMessage = vi.fn()
    window.googlefc = { showRevocationMessage }
    const { result } = renderHook(() => usePrivacyChoices())
    expect(result.current.required).toBe(true)
    result.current.open()
    expect(window.googlefc.callbackQueue).toHaveLength(1)
    window.googlefc.callbackQueue[0]()
    expect(showRevocationMessage).toHaveBeenCalledTimes(1)
    expect(isPrivacyOptionsRequired).not.toHaveBeenCalled()
  })

  it('web: hidden without googlefc', () => {
    env.native = false
    const { result } = renderHook(() => usePrivacyChoices())
    expect(result.current.required).toBe(false)
  })
})
