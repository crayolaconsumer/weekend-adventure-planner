import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react'

const nav = vi.hoisted(() => ({ openMapsDirections: vi.fn() }))
const plugins = vi.hoisted(() => ({ openAppSettings: vi.fn(async () => true), getCurrentPosition: vi.fn(() => new Promise(() => {})) }))
vi.mock('../../../src/utils/navigation', () => nav)
vi.mock('../../../src/utils/nativePlugins', () => plugins)
vi.mock('react-leaflet', () => ({ useMap: () => null, Polyline: () => null }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => km => `${km} km` }))

const { RouteChip } = await import('../../../src/components/map/RouteOverlay.jsx')
const { useRouteLine } = await import('../../../src/hooks/useRouteLine.js')

const to = { lat: 51.5, lng: -0.1, name: 'Gallery' }

describe('RouteChip actions', () => {
  afterEach(() => { vi.clearAllMocks(); delete window.Capacitor })

  it('error state: Open in Maps omits the origin so Maps uses its own location', () => {
    // even if a stale/fallback origin were attached, an error route never sends one
    render(<RouteChip route={{ status: 'error', to, from: { lat: 51.5074, lng: -0.1278, isFallback: true }, mode: 'walk', message: 'Turn on location' }} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Open in Maps/ }))
    expect(nav.openMapsDirections).toHaveBeenCalledWith({ from: undefined, to, mode: 'walk' })
  })

  it('ready state: Open in Maps passes the real origin', () => {
    const from = { lat: 51.49, lng: -0.12 }
    render(<RouteChip route={{ status: 'ready', to, from, mode: 'drive', shownMode: 'drive', duration: 5, distance: 2, positions: [[1, 1], [2, 2]] }} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Open in Maps/ }))
    expect(nav.openMapsDirections).toHaveBeenCalledWith({ from, to, mode: 'drive' })
  })

  it('offers Open Settings after a denied permission on native', async () => {
    render(<RouteChip route={{ status: 'error', to, mode: 'walk', message: 'x', canOpenSettings: true }} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))
    await waitFor(() => expect(plugins.openAppSettings).toHaveBeenCalled())
  })

  it('no Settings button on web', () => {
    render(<RouteChip route={{ status: 'error', to, mode: 'walk', message: 'x', canOpenSettings: false }} onClear={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull()
  })
})

describe('useRouteLine position timeout', () => {
  afterEach(() => vi.useRealTimers())

  it('an unanswered permission prompt ends in the error state, not "Finding route…" forever', async () => {
    vi.useFakeTimers()
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
    const { result } = renderHook(() => useRouteLine())
    act(() => { result.current.request({ from: null, to }) })
    expect(result.current.route.status).toBe('loading')
    await act(async () => { await vi.advanceTimersByTimeAsync(12500) })
    expect(result.current.route).toMatchObject({ status: 'error', canRetry: true })
    expect(result.current.route.canOpenSettings).toBeFalsy()
    delete window.Capacitor
  })
})

describe('useRouteLine location errors', () => {
  afterEach(() => { plugins.getCurrentPosition.mockReset(); delete window.Capacitor })
  const run = async (err) => {
    plugins.getCurrentPosition.mockImplementation(async () => { throw err })
    const { result } = renderHook(() => useRouteLine())
    await act(async () => { await result.current.request({ from: null, to }) })
    return result.current.route
  }

  it('web denial (code 1) → turn on location, no retry', async () => {
    const r = await run(Object.assign(new Error('User denied Geolocation'), { code: 1 }))
    expect(r.message).toMatch(/Turn on location/)
    expect(r.canRetry).toBeFalsy()
  })

  it('native denial (OS-PLUG-GLOC-0003) → turn on location + Settings', async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
    const r = await run(Object.assign(new Error('Location permission request was denied.'), { code: 'OS-PLUG-GLOC-0003' }))
    expect(r).toMatchObject({ canOpenSettings: true })
    expect(r.message).toMatch(/Turn on location/)
  })

  it.each([
    ['web timeout', { code: 3 }],
    ['web unavailable', { code: 2 }],
    ['unsupported', {}],
    ['native timeout', { code: 'OS-PLUG-GLOC-0010' }],
  ])('%s → "Couldn\'t get your location" with a retry, no Settings', async (_, extra) => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
    const r = await run(Object.assign(new Error('x'), extra))
    expect(r.message).toBe("Couldn't get your location. Try again.")
    expect(r.canRetry).toBe(true)
    expect(r.canOpenSettings).toBeFalsy()
  })

  it('Try again re-runs the request for the same place', () => {
    const onRetry = vi.fn()
    const route = { status: 'error', to, mode: 'walk', message: 'x', canRetry: true }
    render(<RouteChip route={route} onClear={() => {}} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith(route)
  })
})
