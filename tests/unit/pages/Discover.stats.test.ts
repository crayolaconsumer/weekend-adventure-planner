import { describe, it, expect } from 'vitest'
import {
  computeStreakRollover,
  buildWentOutPatch,
  buildStreakPatch,
} from '../../../src/pages/Discover/stats'

const TUE = new Date('2026-05-12T12:00:00Z') // Tuesday
const MON = new Date('2026-05-11T12:00:00Z') // Monday (yesterday)
const SAT_LAST_WEEK = new Date('2026-05-09T12:00:00Z') // Saturday (3 days ago)

describe('Discover/stats.computeStreakRollover', () => {
  it("doesn't change anything when lastStreakDate is today", () => {
    const r = computeStreakRollover(
      { currentStreak: 5, bestStreak: 9, lastStreakDate: TUE.toDateString() },
      TUE,
    )
    expect(r.currentStreak).toBe(5)
    expect(r.bestStreak).toBe(9)
  })

  it('increments streak when lastStreakDate was yesterday', () => {
    const r = computeStreakRollover(
      { currentStreak: 5, bestStreak: 9, lastStreakDate: MON.toDateString() },
      TUE,
    )
    expect(r.currentStreak).toBe(6)
    expect(r.bestStreak).toBe(9) // still 9 since 6 < 9
  })

  it('bumps bestStreak when current overtakes it', () => {
    const r = computeStreakRollover(
      { currentStreak: 9, bestStreak: 9, lastStreakDate: MON.toDateString() },
      TUE,
    )
    expect(r.currentStreak).toBe(10)
    expect(r.bestStreak).toBe(10)
  })

  it('resets to 1 when there is a gap of more than one day', () => {
    const r = computeStreakRollover(
      { currentStreak: 5, bestStreak: 9, lastStreakDate: SAT_LAST_WEEK.toDateString() },
      TUE,
    )
    expect(r.currentStreak).toBe(1)
    expect(r.bestStreak).toBe(9)
  })

  it('starts at 1 when no prior streak date', () => {
    const r = computeStreakRollover({}, TUE)
    expect(r.currentStreak).toBe(1)
    expect(r.bestStreak).toBe(1)
  })
})

describe('Discover/stats.buildWentOutPatch', () => {
  it('builds a complete patch with incremented timesWentOut', () => {
    const patch = buildWentOutPatch(
      { timesWentOut: 7, currentStreak: 2, bestStreak: 4, lastStreakDate: MON.toDateString() },
      {},
      TUE,
    )
    expect(patch.timesWentOut).toBe(8)
    expect(patch.currentStreak).toBe(3)
    expect(patch.bestStreak).toBe(4)
    expect(patch.lastStreakDate).toBe(TUE.toISOString())
    expect(patch.lastActivityAt).toBe(TUE.toISOString())
    expect(patch.boredomBusts).toBeUndefined()
  })

  it('bumps boredomBusts when fromJustGo=true', () => {
    const patch = buildWentOutPatch(
      { boredomBusts: 3 },
      { fromJustGo: true },
      TUE,
    )
    expect(patch.boredomBusts).toBe(4)
  })

  it('treats missing counters as 0', () => {
    const patch = buildWentOutPatch({}, { fromJustGo: true }, TUE)
    expect(patch.timesWentOut).toBe(1)
    expect(patch.boredomBusts).toBe(1)
    expect(patch.currentStreak).toBe(1)
  })
})

describe('Discover/stats.buildStreakPatch (any qualifying active event)', () => {
  it('increments the streak the same way buildWentOutPatch does', () => {
    const patch = buildStreakPatch(
      { currentStreak: 2, bestStreak: 4, lastStreakDate: MON.toDateString() },
      TUE,
    )
    expect(patch.currentStreak).toBe(3)
    expect(patch.bestStreak).toBe(4)
    expect(patch.lastStreakDate).toBe(TUE.toISOString())
    expect(patch.lastActivityAt).toBe(TUE.toISOString())
  })

  // The distinction: a qualifying event (e.g. saving a place) counts the
  // streak day WITHOUT bumping the "went out" counters. This is what lets
  // "days the user uses the app" be broader than "days the user went out"
  // while keeping timesWentOut honest.
  it('does NOT bump timesWentOut or boredomBusts', () => {
    const patch = buildStreakPatch(
      { timesWentOut: 7, boredomBusts: 3, currentStreak: 2, lastStreakDate: MON.toDateString() },
      TUE,
    )
    expect(patch.timesWentOut).toBeUndefined()
    expect(patch.boredomBusts).toBeUndefined()
  })

  // Same-day repeat protection: two qualifying events on the same local
  // calendar day produce one increment, not two.
  it('same-day repeat protection: second event on the same day is a no-op', () => {
    const first = buildStreakPatch({}, TUE) // starts the streak
    const second = buildStreakPatch({ ...first, lastStreakDate: TUE.toISOString() }, TUE)
    expect(first.currentStreak).toBe(1)
    expect(second.currentStreak).toBe(1) // no double-count
  })

  // Regression: MySQL DATE columns return date-only strings ("2026-05-12"),
  // which Date parses as UTC midnight. In UTC-behind timezones .toDateString()
  // yields the previous day, breaking the same-day no-op guard and
  // double-counting the streak. The fix parses date-only strings as noon UTC
  // (same calendar day in every timezone).
  it('same-day no-op holds for date-only strings (MySQL DATE round-trip)', () => {
    const r = computeStreakRollover(
      { currentStreak: 5, bestStreak: 9, lastStreakDate: '2026-05-12' },
      new Date('2026-05-12T18:00:00Z'),
    )
    expect(r.currentStreak).toBe(5) // no increment
    expect(r.bestStreak).toBe(9)
  })
})
