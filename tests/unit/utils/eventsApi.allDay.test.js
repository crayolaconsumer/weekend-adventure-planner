import process from 'node:process'
import { describe, it, expect, afterAll, beforeEach, vi, afterEach } from 'vitest'
import { formatEventDate, isEventOver, sortEvents } from '../../../src/utils/eventsApi'
import { normalizeTicketmasterEvent } from '../../../src/utils/ticketmasterApi'

const originalTZ = process.env.TZ
afterAll(() => { process.env.TZ = originalTZ })
beforeEach(() => { process.env.TZ = 'Europe/London' })
afterEach(() => vi.useRealTimers())

describe('date-only events', () => {
  // QA: a Ticketmaster event with only localDate showed "Tomorrow, 1 am" in BST.
  it('a Ticketmaster localDate is an all-day event at local midnight, shown without a time', () => {
    vi.useFakeTimers({ now: new Date('2026-09-26T10:00:00Z'), toFake: ['Date'] })
    const e = normalizeTicketmasterEvent({ id: 'x', name: 'Fair', dates: { start: { localDate: '2026-09-27', dateTBD: false } } })
    expect(e.datetime.allDay).toBe(true)
    expect([e.datetime.start.getDate(), e.datetime.start.getHours()]).toEqual([27, 0])
    expect(formatEventDate(e.datetime.start, !e.datetime.allDay)).toBe('Tomorrow')
  })

  it('stays on the right day west of UTC', () => {
    process.env.TZ = 'America/New_York'
    const e = normalizeTicketmasterEvent({ id: 'x', dates: { start: { localDate: '2026-09-27' } } })
    expect([e.datetime.start.getDate(), e.datetime.start.getHours()]).toEqual([27, 0])
  })

  it('a timed event keeps its time', () => {
    const e = normalizeTicketmasterEvent({ id: 'x', dates: { start: { localDate: '2026-09-27', localTime: '19:30:00', dateTime: '2026-09-27T18:30:00Z' } } })
    expect(e.datetime.allDay).toBe(false)
    expect(e.datetime.start.getHours()).toBe(19)
  })
})

describe('isEventOver', () => {
  const now = new Date('2026-09-27T02:00:00+01:00') // Sun 2am BST
  const at = (iso, extra = {}) => ({ datetime: { start: new Date(iso), ...extra } })

  it('drops a timed event from last night once six hours have passed', () => {
    expect(isEventOver(at('2026-09-26T19:30:00+01:00'), now)).toBe(true)
  })
  it('keeps an event with no end time for six hours (a 10am festival is still on at 2pm)', () => {
    expect(isEventOver(at('2026-09-27T10:00:00+01:00'), new Date('2026-09-27T14:00:00+01:00'))).toBe(false)
  })
  it('keeps one that started within the last few hours', () => {
    expect(isEventOver(at('2026-09-27T00:30:00+01:00'), now)).toBe(false)
  })
  it('uses the end time when there is one', () => {
    expect(isEventOver(at('2026-09-26T21:30:00+01:00', { end: new Date('2026-09-27T04:00:00+01:00') }), now)).toBe(false)
  })
  it('an all-day event lasts until the end of its local day', () => {
    expect(isEventOver(at('2026-09-26T00:00:00+01:00', { allDay: true }), now)).toBe(true)
    expect(isEventOver(at('2026-09-27T00:00:00+01:00', { allDay: true }), new Date('2026-09-27T23:00:00+01:00'))).toBe(false)
  })
  it('an undated event is never over', () => {
    expect(isEventOver({ datetime: {} }, now)).toBe(false)
  })
})

describe('soonest sort', () => {
  it('orders by start ascending', () => {
    const list = [
      { id: 'b', datetime: { start: new Date('2026-09-29T10:00:00Z') } },
      { id: 'a', datetime: { start: new Date('2026-09-28T10:00:00Z') } },
      { id: 'c', datetime: {} },
    ]
    expect(sortEvents(list, 'soonest').map(e => e.id)).toEqual(['a', 'b', 'c'])
  })
})
