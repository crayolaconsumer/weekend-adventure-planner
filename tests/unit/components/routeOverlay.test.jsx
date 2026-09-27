import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { routeSummary, formatDuration } from '../../../src/utils/routeSummary.js'
import { getRouteLine } from '../../../src/utils/routingService.js'
import { useRouteLine, routeForPlaces } from '../../../src/hooks/useRouteLine.js'

const line = [[51.5, -0.1], [51.51, -0.09]]

describe('routeSummary', () => {
  it('real route: time, mode and distance', () => {
    const s = routeSummary({ status: 'ready', mode: 'walk', shownMode: 'walk', duration: 12, distance: 0.9, positions: line })
    expect(s).toEqual({ main: '12 min walk · 0.9 km', note: null })
  })

  it('fallback: says estimate, never claims a route', () => {
    const s = routeSummary({ status: 'ready', mode: 'drive', shownMode: 'drive', duration: 75, distance: 40, positions: null })
    expect(s.main).toBe('About 1 hr 15 min drive')
    expect(s.note).toMatch(/Straight-line estimate/)
  })

  it('transit: is honest that the line is a walking route', () => {
    const s = routeSummary({ status: 'ready', mode: 'transit', shownMode: 'walk', duration: 40, distance: 3, positions: line })
    expect(s.main).toContain('walk')
    expect(s.note).toMatch(/Walking route shown/)
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('1 min')
    expect(formatDuration(60)).toBe('1 hr')
    expect(formatDuration(61)).toBe('1 hr 1 min')
  })
})

describe('getRouteLine', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks for geometry, and for the walking route when mode is transit', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ duration: 30, distance: 2, source: 'api', geometry: line }) }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await getRouteLine({ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }, 'transit')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ mode: 'walk', geometry: true })
    expect(r).toMatchObject({ positions: line, shownMode: 'walk', source: 'api' })
  })

  it('no geometry from the server → no positions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ duration: 30, distance: 2, source: 'fallback' }) })))
    const r = await getRouteLine({ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }, 'drive')
    expect(r.positions).toBeNull()
    expect(r.source).toBe('fallback')
  })

  it('network failure → local estimate, no positions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const r = await getRouteLine({ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }, 'walk')
    expect(r.positions).toBeNull()
    expect(r.duration).toBeGreaterThan(0)
  })
})

describe('useRouteLine', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('drops a stale response when a newer route was asked for', async () => {
    const resolvers = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise(res => resolvers.push(res))))
    const ok = (d) => ({ ok: true, json: async () => ({ duration: d, distance: 1, source: 'api', geometry: line }) })
    const { result } = renderHook(() => useRouteLine())
    const from = { lat: 51.5, lng: -0.1 }

    act(() => { result.current.request({ from, to: { lat: 51.51, lng: -0.09, name: 'A' } }) })
    act(() => { result.current.request({ from, to: { lat: 51.52, lng: -0.08, name: 'B' } }) })
    await waitFor(() => expect(resolvers).toHaveLength(2))
    await act(async () => { resolvers[1](ok(7)) })
    await act(async () => { resolvers[0](ok(99)) })
    expect(result.current.route).toMatchObject({ status: 'ready', duration: 7, to: { name: 'B' } })
  })

  it('clear cancels an in-flight request', async () => {
    let resolve
    vi.stubGlobal('fetch', vi.fn(() => new Promise(res => { resolve = res })))
    const { result } = renderHook(() => useRouteLine())
    act(() => { result.current.request({ from: { lat: 51.5, lng: -0.1 }, to: { lat: 51.51, lng: -0.09 } }) })
    act(() => { result.current.clear() })
    await waitFor(() => expect(resolve).toBeTypeOf('function'))
    await act(async () => { resolve({ ok: true, json: async () => ({ duration: 5, distance: 1, source: 'api', geometry: line }) }) })
    expect(result.current.route).toBeNull()
  })
})

describe('useRouteLine resetKey', () => {
  afterEach(() => vi.unstubAllGlobals())
  const ok = { ok: true, json: async () => ({ duration: 5, distance: 1, source: 'api', geometry: line }) }

  it('clears a drawn route when the key changes (travel mode / origin / place)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok))
    const { result, rerender } = renderHook(({ k }) => useRouteLine(k), { initialProps: { k: 'walking|1,1' } })
    await act(async () => { await result.current.request({ from: { lat: 1, lng: 1 }, to: { lat: 2, lng: 2 } }) })
    expect(result.current.route?.status).toBe('ready')
    rerender({ k: 'driving|1,1' })
    expect(result.current.route).toBeNull()
  })

  it('drops a response that lands after the key changed', async () => {
    let resolve
    vi.stubGlobal('fetch', vi.fn(() => new Promise(res => { resolve = res })))
    const { result, rerender } = renderHook(({ k }) => useRouteLine(k), { initialProps: { k: 'a' } })
    act(() => { result.current.request({ from: { lat: 1, lng: 1 }, to: { lat: 2, lng: 2 } }) })
    rerender({ k: 'b' })
    await waitFor(() => expect(resolve).toBeTypeOf('function'))
    await act(async () => { resolve(ok) })
    expect(result.current.route).toBeNull()
  })
})

describe('routeForPlaces', () => {
  const route = { status: 'ready', to: { id: 'x', lat: 1, lng: 1 } }
  it('hides the route when its pin is filtered off the map', () => {
    expect(routeForPlaces(route, [{ id: 'y' }])).toBeNull()
    expect(routeForPlaces(route, [{ id: 'x' }])).toBe(route)
    expect(routeForPlaces(null, [])).toBeNull()
  })
})
