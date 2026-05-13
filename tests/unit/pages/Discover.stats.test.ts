import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeStreakRollover,
  buildWentOutPatch,
  readPersistedStats,
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
    expect(patch.lastStreakDate).toBe(TUE.toDateString())
    expect(typeof patch.lastActivityDate).toBe('string')
    expect(patch.justGoUses).toBeUndefined()
  })

  it('bumps justGoUses when fromJustGo=true', () => {
    const patch = buildWentOutPatch(
      { justGoUses: 3 },
      { fromJustGo: true },
      TUE,
    )
    expect(patch.justGoUses).toBe(4)
  })

  it('treats missing counters as 0', () => {
    const patch = buildWentOutPatch({}, { fromJustGo: true }, TUE)
    expect(patch.timesWentOut).toBe(1)
    expect(patch.justGoUses).toBe(1)
    expect(patch.currentStreak).toBe(1)
  })
})

describe('Discover/stats.readPersistedStats', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns {} when nothing stored', () => {
    expect(readPersistedStats()).toEqual({})
  })

  it('parses stored JSON', () => {
    localStorage.setItem('roam_stats', JSON.stringify({ timesWentOut: 42 }))
    expect(readPersistedStats().timesWentOut).toBe(42)
  })

  it('returns {} on corrupt JSON instead of throwing', () => {
    localStorage.setItem('roam_stats', 'not json')
    expect(readPersistedStats()).toEqual({})
  })
})
