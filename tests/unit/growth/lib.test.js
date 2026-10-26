// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { isoWeek, mondayOf, reportWindow, days, change, delta, pickLeak, leakSentence, parseDelimited, decodeText, sumInWindow, goalProgress } from '../../../scripts/growth/lib.mjs'

describe('ISO weeks', () => {
  it('labels weeks across year boundaries like ISO 8601', () => {
    expect(isoWeek(new Date('2026-10-19T00:00:00Z'))).toBe('2026-W43')
    expect(isoWeek(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01') // Monday of W01 2026
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53') // 2026 has 53 weeks
    expect(isoWeek(new Date('2021-01-03T00:00:00Z'))).toBe('2020-W53')
  })
  it('round-trips label -> Monday', () => {
    for (const l of ['2026-W01', '2026-W43', '2026-W53', '2020-W53']) expect(isoWeek(mondayOf(l))).toBe(l)
    expect(mondayOf('2026-W43').toISOString()).toBe('2026-10-19T00:00:00.000Z')
    expect(() => mondayOf('2026-43')).toThrow(/bad ISO week/)
  })
  it('defaults to the last complete week, whatever weekday it runs on', () => {
    for (const now of ['2026-10-26T06:00:00Z', '2026-10-28T12:00:00Z', '2026-11-01T23:59:59Z']) {
      const w = reportWindow(new Date(now))
      expect(w.week).toBe('2026-W43')
      expect(w.start.toISOString()).toBe('2026-10-19T00:00:00.000Z')
      expect(w.end.toISOString()).toBe('2026-10-26T00:00:00.000Z')
      expect(w.prevWeek).toBe('2026-W42')
    }
    expect(reportWindow(new Date(), '2026-W40').start.toISOString()).toBe('2026-09-28T00:00:00.000Z')
  })
  it('lists days half-open', () => {
    expect(days(new Date('2026-10-19T00:00:00Z'), new Date('2026-10-22T00:00:00Z'))).toEqual(['2026-10-19', '2026-10-20', '2026-10-21'])
  })
})

describe('arithmetic', () => {
  it('change and delta handle zero bases', () => {
    expect(change(3, 0)).toBeNull()
    expect(change(15, 10)).toBe(0.5)
    expect(delta(15, 10)).toBe('15 (+5, +50% vs last week)')
    expect(delta(5, 10)).toBe('5 (-5, -50% vs last week)')
    expect(delta(null, 3)).toBe('n/a')
  })
  it('goal progress: 4 of 500 with 67 days left', () => {
    const g = goalProgress(4, 500, new Date('2026-10-26T00:00:00Z'), new Date('2027-01-01T00:00:00Z'))
    expect(g.daysLeft).toBe(67)
    expect(g.progress).toBe(0.008)
    expect(g.perWeek).toBeCloseTo(496 / (67 / 7), 10)
    expect(g.weeklyGrowth).toBeCloseTo((500 / 4) ** (7 / 67) - 1, 10)
    expect(goalProgress(0, 500, new Date('2026-10-26T00:00:00Z'), new Date('2027-01-01T00:00:00Z')).weeklyGrowth).toBeNull()
    expect(goalProgress(600, 500, new Date('2027-02-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'))).toMatchObject({ daysLeft: 0, gap: 0, perWeek: null })
  })
})

describe('pickLeak', () => {
  const steps = (...v) => v.map(([label, value, prev]) => ({ label, value, prev }))
  it('picks the biggest step-to-step drop', () => {
    const l = pickLeak(steps(['Visitors', 1000, 900], ['Installs', 100, 90], ['Signups', 80, 70], ['Activated', 10, 9]))
    expect(l).toMatchObject({ kind: 'step', from: 'Visitors', to: 'Installs', base: 1000, value: 100 })
    expect(l.drop).toBeCloseTo(0.9)
    expect(leakSentence(l)).toContain('only 100 of 1000 made it (10.0% conversion, 90.0% lost)')
  })
  it('a week-over-week collapse beats a normal step drop', () => {
    const l = pickLeak(steps(['Signups', 2, 40], ['Activated', 1, 20]))
    expect(l).toMatchObject({ kind: 'wow', to: 'Signups', base: 40, value: 2 })
    expect(leakSentence(l)).toMatch(/fell from 40 last week to 2 this week \(-95\.0%\)/)
  })
  it('skips unconnected steps and compares across the gap', () => {
    const l = pickLeak(steps(['Visitors', null, null], ['Installs', 50, 50], ['Signups', 10, 10]))
    expect(l).toMatchObject({ from: 'Installs', to: 'Signups' })
  })
  it('ties go to the earlier step', () => {
    const l = pickLeak(steps(['A', 100, null], ['B', 50, null], ['C', 25, null]))
    expect(l).toMatchObject({ from: 'A', to: 'B' })
  })
  it('an empty first step is the leak; nothing at all is null', () => {
    const l = pickLeak(steps(['Signups', 0, 0], ['Activated', 0, 0]))
    expect(l).toMatchObject({ kind: 'empty', to: 'Signups' })
    expect(leakSentence(l)).toContain('**Signups: 0 this week (0 last week).**')
    expect(pickLeak(steps(['Signups', null, null]))).toBeNull()
    expect(leakSentence(null)).toMatch(/Not enough/)
  })
  it('flags small samples', () => {
    expect(leakSentence(pickLeak(steps(['Signups', 5, null], ['Activated', 1, null])))).toMatch(/Small sample \(base 5\)/)
  })
})

describe('parsing', () => {
  it('parses TSV and quoted CSV', () => {
    expect(parseDelimited('Date\tCounts\n2026-10-19\t3\n2026-10-20\t4\n', '\t')).toEqual([{ Date: '2026-10-19', Counts: '3' }, { Date: '2026-10-20', Counts: '4' }])
    expect(parseDelimited('﻿a,b\r\n"x, y","say ""hi"""\r\n', ',')).toEqual([{ a: 'x, y', b: 'say "hi"' }])
  })
  it('decodes UTF-16LE Play files and UTF-8 otherwise', () => {
    const csv = 'Date,Daily User Installs\n2026-10-19,7\n'
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]))).toBe(csv)
    expect(decodeText(Buffer.from(csv))).toBe(csv)
  })
  it('sums only rows inside the window that pass the filter', () => {
    const rows = [{ Date: '2026-10-18', n: '100' }, { Date: '2026-10-19', n: '1,000' }, { Date: '2026-10-25', n: '2', t: 'x' }, { Date: '2026-10-26', n: '50' }]
    const w = [new Date('2026-10-19T00:00:00Z'), new Date('2026-10-26T00:00:00Z')]
    expect(sumInWindow(rows, 'Date', 'n', ...w)).toBe(1002)
    expect(sumInWindow(rows, 'Date', 'n', ...w, r => r.t === 'x')).toBe(2)
  })
})
