import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { applyDiscoverFilters, firstOpening } from '../../../src/pages/Discover/applyFilters'
import ClosedNowNotice, { formatOpening } from '../../../src/pages/Discover/ClosedNowNotice.jsx'

const defaults = {
  selectedCategories: [], showFreeOnly: false, accessibilityMode: false,
  showLocalsPicks: false, showOffPeak: false, isPremium: false, userProfile: null, weather: null, friendActivity: null,
}
const place = (id, extra) => ({ id, name: `Place ${id}`, type: 'restaurant', lat: 51.5, lng: -0.1, website: 'https://x.test', ...extra })
const open = place('open', { openingHours: '24/7' })
const closed = place('closed', { openingHours: 'Mo-Su 09:00-17:00' })
const unknown = place('unknown')
const privateClub = place('private', { access: 'private' })

// Wednesday 10 June 2026, 11pm: the 9-5 place is shut until Thursday 9am
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 5, 10, 23, 0))
})
afterAll(() => vi.useRealTimers())

const ids = list => list.map(p => p.id).sort()

describe('Discover deck drops places that are closed right now', () => {
  it('keeps open and unknown-hours places, drops closed and private ones', () => {
    expect(ids(applyDiscoverFilters([open, closed, unknown, privateClub], defaults))).toEqual(['open', 'unknown'])
  })

  it('includes closed places (never private ones) when the user opts in', () => {
    const out = applyDiscoverFilters([open, closed, unknown, privateClub], { ...defaults, includeClosed: true })
    expect(ids(out)).toEqual(['closed', 'open', 'unknown'])
  })

  it('works out when the first closed place opens', () => {
    const first = firstOpening([open, closed, unknown, place('later', { openingHours: 'Mo-Su 11:00-17:00' })])
    expect(first).toEqual(new Date(2026, 5, 11, 9, 0))
    expect(firstOpening([open, unknown])).toBeNull()
  })
})

describe('ClosedNowNotice', () => {
  it('formats the opening time, with the day when it is not today', () => {
    const now = new Date(2026, 5, 10, 23, 0)
    expect(formatOpening(new Date(2026, 5, 11, 9, 0), now)).toBe('Thu 9 am')
    expect(formatOpening(new Date(2026, 5, 10, 23, 30), now)).toBe('11:30 pm')
    expect(formatOpening(null, now)).toBeNull()
  })

  it('shows the friendly closed state with a labelled toggle', () => {
    const onToggle = vi.fn()
    render(<ClosedNowNotice openCount={0} firstOpens={new Date(2026, 5, 11, 9, 0)} includeClosed={false} onToggle={onToggle} />)
    expect(screen.getByRole('heading', { name: 'Everything nearby is closed right now' })).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Show places that open later (from Thu 9 am)' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('says most only when closed places outnumber open ones', () => {
    render(<ClosedNowNotice openCount={3} closedCount={9} firstOpens={null} includeClosed={false} onToggle={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Most places nearby are closed right now' })).toBeInTheDocument()
    expect(screen.getByText(/3 places are open now, 9 more open later/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show places that open later' })).toBeInTheDocument()
  })

  it('never claims most are closed when most are open (regression: rural 2pm, one closed museum)', () => {
    render(<ClosedNowNotice openCount={5} closedCount={1} firstOpens={null} includeClosed={false} onToggle={() => {}} />)
    expect(screen.getByRole('heading', { name: 'More places nearby open later' })).toBeInTheDocument()
    expect(screen.getByText(/5 places are open now, 1 more opens later/)).toBeInTheDocument()
  })

  it('blames the filters, not the area, when filters are on (regression: pubs-only at 10am)', () => {
    render(<ClosedNowNotice openCount={0} closedCount={4} filtered firstOpens={null} includeClosed={false} onToggle={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Everything nearby matching your filters is closed right now' })).toBeInTheDocument()
  })

  it('offers to hide closed places again once they are included', () => {
    render(<ClosedNowNotice openCount={3} includeClosed onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Hide closed places' })).toHaveAttribute('aria-pressed', 'true')
  })
})
