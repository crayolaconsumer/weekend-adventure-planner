import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MapContainer } from 'react-leaflet'
import { RouteLine } from '../../../src/components/map/RouteOverlay'

// Regression: closing the place sheet with a route drawn threw
// "Cannot set properties of undefined (setting '_leaflet_pos')" because the
// re-centre cleanup ran on a map Leaflet had already removed.
describe('RouteLine on a real map', () => {
  it('unmounts cleanly with a route drawn', () => {
    const line = [[51.5, -0.1], [51.51, -0.09]]
    const { unmount } = render(
      <div style={{ width: 300, height: 200 }}>
        <MapContainer center={[51.505, -0.095]} zoom={15} style={{ width: 300, height: 200 }} attributionControl={false}>
          <RouteLine positions={line} home={[51.505, -0.095]} homeZoom={15} />
        </MapContainer>
      </div>
    )
    expect(() => unmount()).not.toThrow()
  })
})
