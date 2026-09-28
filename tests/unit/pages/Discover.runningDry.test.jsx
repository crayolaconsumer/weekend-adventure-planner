/**
 * Discover deck freshness, rubric point 5 (the UI half): running dry is
 * said plainly, with the next distance out and clearing filters on offer.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DeckRunningDryNotice, { nextWider } from '../../../src/pages/Discover/DeckRunningDryNotice'

const props = over => ({
  freshCount: 12, recycledCount: 0, travelMode: 'walking', selectedBand: 'medium', isPremium: false, hasFilters: false,
  onBandChange: vi.fn(), onTravelModeChange: vi.fn(), onClearFilters: vi.fn(), ...over,
})

describe('nextWider', () => {
  it('steps to the next band out, then to a wider travel mode', () => {
    expect(nextWider('walking', 'short', false)).toEqual({ band: 'medium', label: 'Look further: 1.5 km to 3 km' })
    expect(nextWider('walking', 'medium', false)).toEqual({ band: 'long', label: 'Look further: 3 km to 5 km' })
    expect(nextWider('walking', 'long', false)).toEqual({ mode: 'transit', label: 'Switch to transit (up to 15 km)' })
    expect(nextWider('transit', 'long', false)).toEqual({ mode: 'driving', label: 'Switch to driving (up to 30 km)' })
  })

  it('only offers premium modes to ROAM+ users', () => {
    expect(nextWider('driving', 'long', false)).toBeNull()
    expect(nextWider('driving', 'long', true)).toEqual({ mode: 'dayTrip', label: 'Switch to day trip (up to 75 km)' })
  })
})

describe('DeckRunningDryNotice', () => {
  it('says how many new places are left and offers the next band out', () => {
    const p = props()
    render(<DeckRunningDryNotice {...p} />)
    expect(screen.getByRole('heading')).toHaveTextContent('Only 12 new places left in this range')
    expect(screen.getByRole('status')).toHaveTextContent("You've swiped the rest. To see new places, search further out.")
    fireEvent.click(screen.getByRole('button', { name: 'Look further: 3 km to 5 km' }))
    expect(p.onBandChange).toHaveBeenCalledWith('long')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('nothing new: says so, offers a wider mode and clearing filters, and names recycled cards', () => {
    const p = props({ freshCount: 0, recycledCount: 10, selectedBand: 'long', hasFilters: true })
    render(<DeckRunningDryNotice {...p} />)
    expect(screen.getByRole('heading')).toHaveTextContent("You've swiped every place in this range")
    expect(screen.getByRole('status')).toHaveTextContent(
      "Nothing here is new to you. To see new places, search further out or clear your filters. Until then, the last 10 cards are places you skipped longest ago.",
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch to transit (up to 15 km)' }))
    expect(p.onTravelModeChange).toHaveBeenCalledWith('transit')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(p.onClearFilters).toHaveBeenCalled()
  })

  it('one new place, one recycled: singular copy', () => {
    render(<DeckRunningDryNotice {...props({ freshCount: 1, recycledCount: 1 })} />)
    expect(screen.getByRole('heading')).toHaveTextContent('Only 1 new place left in this range')
    expect(screen.getByRole('status')).toHaveTextContent('the last card is a place you skipped longest ago.')
  })

  it('compact strip above a deck that still has cards', () => {
    const { container } = render(<DeckRunningDryNotice {...props({ compact: true })} />)
    expect(container.firstChild).toHaveClass('discover-closed-notice', 'compact')
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent("Only 12 new places left in this range. You've swiped the rest. To see new places, search further out.")
  })

  it('no wider option and no filters: no dead-end buttons', () => {
    render(<DeckRunningDryNotice {...props({ travelMode: 'driving', selectedBand: 'long' })} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent(/^Only 12 new places left in this range\s*You've swiped the rest\.$/)
  })
})
