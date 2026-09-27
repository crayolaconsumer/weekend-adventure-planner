import process from 'node:process'
import { describe, it, expect, afterAll } from 'vitest'
import { getDateOptions, parseLocalDate, localISODate } from '../../../src/components/PlanVisitSheet'

const originalTZ = process.env.TZ

describe('PlanVisitSheet dates', () => {
  afterAll(() => { process.env.TZ = originalTZ })

  it("'This Weekend' on a Saturday is today, not next Saturday", () => {
    const sat = new Date(2026, 9, 3, 9) // Sat 3 Oct 2026, local
    const opt = getDateOptions(sat).find(o => o.id === 'this-weekend')
    expect(opt.label).toBe('Today')
    expect(opt.date.getDate()).toBe(3)
  })

  it('on a Sunday it is the coming Saturday; on a Monday this Saturday', () => {
    expect(getDateOptions(new Date(2026, 9, 4, 9)).find(o => o.id === 'this-weekend').date.getDate()).toBe(10)
    expect(getDateOptions(new Date(2026, 9, 5, 9)).find(o => o.id === 'this-weekend').date.getDate()).toBe(10)
  })

  it('custom date parses as local midnight west of UTC (was a day early)', () => {
    process.env.TZ = 'America/New_York'
    const d = parseLocalDate('2026-10-03')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 3, 0])
  })

  it("the picker's min is today's local date, not the UTC date", () => {
    process.env.TZ = 'America/Los_Angeles'
    // 20:00 on 3 Oct in LA is 03:00 on 4 Oct UTC
    expect(localISODate(new Date('2026-10-04T03:00:00Z'))).toBe('2026-10-03')
  })
})
