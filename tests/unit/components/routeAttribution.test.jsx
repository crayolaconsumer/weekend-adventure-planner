import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import L from 'leaflet'

const fake = vi.hoisted(() => ({ map: null }))
vi.mock('react-leaflet', () => ({ useMap: () => fake.map, Polyline: () => null }))
vi.mock('../../../src/contexts/DistanceContext', () => ({ useFormatDistance: () => km => `${km} km` }))

const { RouteLine } = await import('../../../src/components/map/RouteOverlay.jsx')
const line = [[51.5, -0.1], [51.51, -0.09]]

describe('RouteLine ORS attribution', () => {
  afterEach(() => vi.restoreAllMocks())

  it('credits openrouteservice by HeiGIT while a route is drawn, and removes it after', () => {
    const control = { addAttribution: vi.fn(), removeAttribution: vi.fn() }
    fake.map = { attributionControl: control, fitBounds: vi.fn() }
    const { unmount } = render(<RouteLine positions={line} />)
    expect(control.addAttribution.mock.calls[0][0]).toMatch(/openrouteservice\.org.*by HeiGIT/)
    unmount()
    expect(control.removeAttribution).toHaveBeenCalledWith(control.addAttribution.mock.calls[0][0])
  })

  it('adds a temporary control on maps built without one (place preview)', () => {
    const created = { addAttribution: vi.fn(function () { return this }), addTo: vi.fn(function () { return this }), getContainer: () => document.createElement('div'), remove: vi.fn() }
    vi.spyOn(L.control, 'attribution').mockReturnValue(created)
    fake.map = { attributionControl: null, fitBounds: vi.fn() }
    const { unmount } = render(<RouteLine positions={line} />)
    expect(created.addAttribution.mock.calls[0][0]).toMatch(/HeiGIT/)
    expect(created.addTo).toHaveBeenCalledWith(fake.map)
    unmount()
    expect(created.remove).toHaveBeenCalled()
  })

  it('adds no credit when there is no real route', () => {
    const control = { addAttribution: vi.fn(), removeAttribution: vi.fn() }
    fake.map = { attributionControl: control, fitBounds: vi.fn() }
    render(<RouteLine positions={null} />)
    expect(control.addAttribution).not.toHaveBeenCalled()
  })

  it('re-centres a non-pannable map on the place when the route is cleared', () => {
    const control = { addAttribution: vi.fn(), removeAttribution: vi.fn() }
    fake.map = { attributionControl: control, fitBounds: vi.fn(), setView: vi.fn(), _mapPane: {} }
    const { rerender } = render(<RouteLine positions={line} home={[51.508, -0.076]} homeZoom={15} />)
    expect(fake.map.setView).not.toHaveBeenCalled()
    rerender(<RouteLine positions={null} home={[51.508, -0.076]} homeZoom={15} />)
    expect(fake.map.setView).toHaveBeenCalledWith([51.508, -0.076], 15, { animate: false })
  })

  it('leaves pannable maps (no home) where the user put them', () => {
    fake.map = { attributionControl: { addAttribution: vi.fn(), removeAttribution: vi.fn() }, fitBounds: vi.fn(), setView: vi.fn() }
    const { rerender } = render(<RouteLine positions={line} />)
    rerender(<RouteLine positions={null} />)
    expect(fake.map.setView).not.toHaveBeenCalled()
  })
})
