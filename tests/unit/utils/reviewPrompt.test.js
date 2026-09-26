import { describe, it, expect, vi, beforeEach } from 'vitest'

const requestReview = vi.fn(async () => {})
const track = vi.fn()
let native = true
vi.mock('@capacitor-community/in-app-review', () => ({ InAppReview: { requestReview: () => requestReview() } }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => native }))
vi.mock('../../../src/utils/analytics', () => ({ track: (...a) => track(...a) }))
const { shouldAskForReview, afterLovedVisit } = await import('../../../src/utils/reviewPrompt')

const DAY = 86400000
beforeEach(() => { localStorage.clear(); requestReview.mockClear(); track.mockClear(); native = true })

describe('shouldAskForReview', () => {
  it('never on the first loved visit', () => expect(shouldAskForReview({ lovedVisits: 1, lastAskedAt: 0 })).toBe(false))
  it('from the second loved visit', () => expect(shouldAskForReview({ lovedVisits: 2, lastAskedAt: 0 })).toBe(true))
  it('at most every 120 days', () => {
    const now = 1_800_000_000_000
    expect(shouldAskForReview({ lovedVisits: 9, lastAskedAt: now - 119 * DAY, now })).toBe(false)
    expect(shouldAskForReview({ lovedVisits: 9, lastAskedAt: now - 120 * DAY, now })).toBe(true)
  })
})

describe('afterLovedVisit', () => {
  it('asks once on the 2nd loved visit, then waits', async () => {
    expect(await afterLovedVisit()).toBe(false)
    expect(await afterLovedVisit()).toBe(true)
    expect(requestReview).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('review_prompt_requested', { lovedVisits: 2 })
    expect(await afterLovedVisit()).toBe(false) // within 120 days
    expect(requestReview).toHaveBeenCalledTimes(1)
  })

  it('does nothing on the web', async () => {
    native = false
    await afterLovedVisit(); await afterLovedVisit()
    expect(requestReview).not.toHaveBeenCalled()
  })

  it('never throws, even if the plugin fails', async () => {
    requestReview.mockRejectedValueOnce(new Error('no plugin'))
    await afterLovedVisit()
    await expect(afterLovedVisit()).resolves.toBe(false)
  })
})
