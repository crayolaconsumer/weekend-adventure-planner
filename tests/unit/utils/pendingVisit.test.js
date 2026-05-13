import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPendingVisit, setPendingVisit, clearPendingVisit } from '../../../src/utils/pendingVisit.js'

describe('pendingVisit', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when nothing pending', () => {
    expect(getPendingVisit()).toBe(null)
  })

  it('returns null within 30s grace window', () => {
    setPendingVisit({ id: 'p1', name: 'Castle' })
    // No time advance — < 30s
    expect(getPendingVisit()).toBe(null)
  })

  it('returns the place after 30s', () => {
    setPendingVisit({ id: 'p1', name: 'Castle' })
    vi.advanceTimersByTime(31 * 1000)
    const place = getPendingVisit()
    expect(place?.id).toBe('p1')
    expect(place?.name).toBe('Castle')
  })

  it('clears entries older than 24h', () => {
    setPendingVisit({ id: 'p1', name: 'Castle' })
    vi.advanceTimersByTime(25 * 60 * 60 * 1000)
    expect(getPendingVisit()).toBe(null)
    // Verify it was actively cleared
    expect(localStorage.getItem('roam_pending_visit')).toBe(null)
  })

  it('clearPendingVisit removes the entry', () => {
    setPendingVisit({ id: 'p1', name: 'Castle' })
    clearPendingVisit()
    vi.advanceTimersByTime(60 * 1000)
    expect(getPendingVisit()).toBe(null)
  })

  it('returns null on corrupt JSON', () => {
    localStorage.setItem('roam_pending_visit', 'not json')
    expect(getPendingVisit()).toBe(null)
  })
})
