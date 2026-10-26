import process from 'node:process'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requestReview = vi.fn(async () => {})
const track = vi.fn()
let native = true
vi.mock('@capacitor-community/in-app-review', () => ({ InAppReview: { requestReview: () => requestReview() } }))
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => native }))
vi.mock('../../../src/utils/analytics', () => ({ track: (...a) => track(...a) }))
const { shouldAskForReview, recordHappyMoment, afterLovedVisit } = await import('../../../src/utils/reviewPrompt')

const DAY = 86400000
const T0 = new Date(2026, 9, 26, 12).getTime() // local noon, so +DAY is always another calendar day
const ASKED_KEY = 'roam_review_asked_at'
beforeEach(() => { localStorage.clear(); requestReview.mockReset().mockResolvedValue(); track.mockClear(); native = true })

describe('shouldAskForReview', () => {
  const ok = { moments: 3, activeDays: 2, lastAskedAt: 0, now: T0 }
  it('asks at 3 moments over 2 days, never asked', () => expect(shouldAskForReview(ok)).toBe(true))
  it('not with 2 moments', () => expect(shouldAskForReview({ ...ok, moments: 2 })).toBe(false))
  it('not when every moment was on one day', () => expect(shouldAskForReview({ ...ok, moments: 9, activeDays: 1 })).toBe(false))
  it('at most every 120 days', () => {
    expect(shouldAskForReview({ ...ok, lastAskedAt: T0 - 119 * DAY })).toBe(false)
    expect(shouldAskForReview({ ...ok, lastAskedAt: T0 - 120 * DAY })).toBe(true)
  })
})

describe('recordHappyMoment', () => {
  it('waits for a 2nd day, asks once, then stays quiet for 120 days', async () => {
    expect(await recordHappyMoment('place_saved', T0)).toBe(false)
    expect(await recordHappyMoment('place_saved', T0 + 1000)).toBe(false)
    expect(await recordHappyMoment('place_saved', T0 + 2000)).toBe(false) // 3 moments, 1 day
    expect(requestReview).not.toHaveBeenCalled()

    expect(await recordHappyMoment('plan_saved', T0 + DAY)).toBe(true)
    expect(requestReview).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(ASKED_KEY)).toBe(String(T0 + DAY))
    expect(track).toHaveBeenCalledWith('review_prompt_requested', { trigger: 'plan_saved', moments: 4, activeDays: 2 })

    expect(await recordHappyMoment('visit_marked', T0 + 2 * DAY)).toBe(false)
    expect(await recordHappyMoment('visit_marked', T0 + DAY + 119 * DAY)).toBe(false)
    expect(await recordHappyMoment('visit_marked', T0 + DAY + 120 * DAY)).toBe(true)
    expect(requestReview).toHaveBeenCalledTimes(2)
  })

  it('does nothing on the web, and stores nothing', async () => {
    native = false
    for (let i = 0; i < 5; i++) await recordHappyMoment('place_saved', T0 + i * DAY)
    expect(requestReview).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('a missing/failing plugin never throws and never sets ASKED_KEY', async () => {
    requestReview.mockRejectedValue(new Error('plugin not implemented'))
    await recordHappyMoment('place_saved', T0)
    await recordHappyMoment('place_saved', T0 + 1)
    await expect(recordHappyMoment('place_saved', T0 + DAY)).resolves.toBe(false)
    expect(requestReview).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(ASKED_KEY)).toBeNull()
    expect(track).not.toHaveBeenCalled()
    // next build has the plugin: asks at the next moment instead of waiting 120 days
    requestReview.mockResolvedValue()
    expect(await recordHappyMoment('place_saved', T0 + DAY + 1)).toBe(true)
  })

  it('storage that throws never breaks the caller', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    await expect(recordHappyMoment('place_saved', T0)).resolves.toBe(false)
    get.mockRestore()
  })

  it('corrupt stored state starts over instead of throwing', async () => {
    localStorage.setItem('roam_happy_moments', '{bad json')
    await expect(recordHappyMoment('place_saved', T0)).resolves.toBe(false)
    localStorage.setItem('roam_happy_moments', '{"count":"x","days":"nope"}')
    await expect(recordHappyMoment('place_saved', T0)).resolves.toBe(false)
    expect(JSON.parse(localStorage.getItem('roam_happy_moments'))).toEqual({ count: 1, days: ['2026-10-26'] })
  })

  it('a moment while a request is pending does not request again', async () => {
    await recordHappyMoment('place_saved', T0)
    await recordHappyMoment('place_saved', T0 + 1)
    let release
    requestReview.mockImplementationOnce(() => new Promise(r => { release = r }))
    const a = recordHappyMoment('place_saved', T0 + DAY)
    await vi.waitFor(() => expect(requestReview).toHaveBeenCalledTimes(1)) // first prompt still pending
    const b = recordHappyMoment('visit_marked', T0 + DAY)
    await new Promise(r => setTimeout(r, 0))
    release()
    expect([await a, await b].filter(Boolean)).toHaveLength(1)
    expect(requestReview).toHaveBeenCalledTimes(1)
  })
})

describe('afterLovedVisit', () => {
  it('adds no moment (the visit already counted), but asks if the rule is already met', async () => {
    localStorage.setItem('roam_happy_moments', JSON.stringify({ count: 3, days: ['2020-1-1', '2020-1-2'] }))
    expect(await afterLovedVisit()).toBe(true)
    expect(track).toHaveBeenCalledWith('review_prompt_requested', expect.objectContaining({ trigger: 'loved_visit', moments: 3 }))
  })
  it('a loved visit on a new day does not count that day: 3 moments all on one earlier day, no request', async () => {
    localStorage.setItem('roam_happy_moments', JSON.stringify({ count: 3, days: ['2020-1-1'] }))
    expect(await afterLovedVisit(T0)).toBe(false)
    expect(requestReview).not.toHaveBeenCalled()
  })
  it('one loved visit is one action: 2 moments stay 2, no request', async () => {
    localStorage.setItem('roam_happy_moments', JSON.stringify({ count: 2, days: ['2020-1-1'] }))
    expect(await afterLovedVisit(T0)).toBe(false)
    expect(JSON.parse(localStorage.getItem('roam_happy_moments'))).toEqual({ count: 2, days: ['2020-1-1'] })
    expect(requestReview).not.toHaveBeenCalled()
  })
})

describe('distinct days are local calendar days', () => {
  it('23:30 and 00:30 the next night in Los Angeles are two days (one UTC day)', async () => {
    const tz = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      const lateNight = new Date(2026, 9, 26, 23, 30).getTime()
      const justAfterMidnight = lateNight + 60 * 60 * 1000
      expect(new Date(lateNight).toISOString().slice(0, 10)).toBe(new Date(justAfterMidnight).toISOString().slice(0, 10)) // same UTC day
      await recordHappyMoment('place_saved', lateNight)
      await recordHappyMoment('place_saved', lateNight + 60000)
      expect(await recordHappyMoment('place_saved', justAfterMidnight)).toBe(true) // 3 moments, 2 local days
    } finally {
      process.env.TZ = tz
    }
  })
})
