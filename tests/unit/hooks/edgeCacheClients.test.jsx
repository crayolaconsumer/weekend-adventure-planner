import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { fetchBatchContributions, clearContributionCache } from '../../../src/hooks/useTopContributions'
import { useTrendingPlaces, clearTrendingCache } from '../../../src/hooks/useTrendingPlaces'
import { useSponsoredPlaces } from '../../../src/hooks/useSponsoredPlaces'
import { fetchPromotedEvents } from '../../../src/utils/promotedEventsApi'

// Issue #22 client half. Signed-in requests to routes that answer guests from
// the edge cache must carry Authorization (web too, not just the cookie), so
// the CDN never hands them the shared guest copy. Public routes build URLs
// that neighbours share.

let fetchMock
const authOf = call => new Headers(call?.[1]?.headers).get('Authorization')

beforeEach(() => {
  clearContributionCache(); clearTrendingCache()
  localStorage.clear(); sessionStorage.clear()
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ contributions: {}, trending: [], sponsored: [], promoted: [] }) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('signed-in reads of edge-cached routes send the token', () => {
  it('card tips: guest sends none, signed-in sends Bearer', async () => {
    await fetchBatchContributions(['node/1'])
    expect(authOf(fetchMock.mock.calls[0])).toBeNull()

    clearContributionCache()
    localStorage.setItem('roam_auth_token', 'tok')
    await fetchBatchContributions(['node/1'])
    expect(authOf(fetchMock.mock.calls[1])).toBe('Bearer tok')
  })

  it('a cookie-only signed-in tab (cached user, no token) still never gets the guest URL', async () => {
    localStorage.setItem('roam_cached_user', JSON.stringify({ id: 1 }))
    await fetchBatchContributions(['node/1'])
    expect(new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams.get('viewer')).toBe('1')
  })

  it('guests keep the shared URL (no viewer marker)', async () => {
    await fetchBatchContributions(['node/1'])
    expect(new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams.has('viewer')).toBe(false)
  })

  it('trending: signed-in sends Bearer and the viewer marker', async () => {
    sessionStorage.setItem('roam_auth_token_session', 'stok')
    renderHook(() => useTrendingPlaces())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(authOf(fetchMock.mock.calls[0])).toBe('Bearer stok')
    expect(fetchMock.mock.calls[0][0]).toMatch(/&viewer=1$/)
  })
})

describe('public routes build shareable URLs', () => {
  it('sponsored: no coordinates in the URL; distance computed on the device', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ sponsored: [{ sponsored_id: 1, place: { id: 'p', lat: 51.51, lng: -0.1, distance: null } }] }) }))
    const { result } = renderHook(() => useSponsoredPlaces({ lat: 51.5, lng: -0.1 }))
    await waitFor(() => expect(result.current.sponsoredPlaces).toHaveLength(1))
    const url = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(url.pathname).toBe('/api/ads/sponsored')
    expect(url.searchParams.has('lat')).toBe(false)
    expect(url.searchParams.has('lng')).toBe(false)
    expect(result.current.sponsoredPlaces[0].place.distance).toBeCloseTo(1.1, 1)
  })

  it('promoted events: the paid radius is applied to the exact location, not the rounded one', async () => {
    const ev = (id, lat, lng) => ({ id, title: id, startsAt: '2026-11-01T19:00:00Z', venue: { lat, lng }, promoRadiusKm: 5 })
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ promoted: [
      ev('inside', 51.46108, -0.17238), // 4.63 km from the user (5.23 km from the rounded point)
      ev('outside', 51.53578, -0.09105), // 5.41 km from the user (4.81 km from the rounded point)
    ] }) }))
    const events = await fetchPromotedEvents(51.4955, -0.1349, 30)
    expect(events.map(e => e.name)).toEqual(['inside'])
  })

  it('promoted events: the user filter radius still caps it', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ promoted: [
      { id: 'far', title: 'far', startsAt: '2026-11-01T19:00:00Z', venue: { lat: 51.46108, lng: -0.17238 }, promoRadiusKm: 50 },
    ] }) }))
    expect(await fetchPromotedEvents(51.4955, -0.1349, 4)).toEqual([])
  })

  it('promoted events: coordinates rounded to 0.01 deg', async () => {
    await fetchPromotedEvents(51.50735, -0.12776, 30)
    const url = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(url.searchParams.get('lat')).toBe('51.51')
    expect(url.searchParams.get('lng')).toBe('-0.13')
  })
})
