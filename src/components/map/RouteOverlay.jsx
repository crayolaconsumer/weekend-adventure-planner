/**
 * Route overlay shared by the Discover map and the place map.
 *
 * RouteLine draws a real route (white casing under a terracotta line) and
 * fits the map to it; it renders nothing without real geometry, so a
 * fallback estimate is never drawn as a fake straight line.
 * RouteChip is the travel time readout with "Open in Maps" and clear
 * controls, inside a polite live region so the time is announced.
 */
import { useEffect } from 'react'
import { Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { openMapsDirections } from '../../utils/navigation'
import { useFormatDistance } from '../../contexts/DistanceContext'
import { routeSummary } from '../../utils/routeSummary'
import './RouteOverlay.css'

// ORS terms: credit where a route is shown
const ORS_ATTRIBUTION = '© <a href="https://openrouteservice.org/" target="_blank" rel="noopener">openrouteservice.org</a> by HeiGIT'

/**
 * @param {Array<[number,number]>|null} positions
 * @param {[number,number]} [home] - view to return to when the line goes
 *   away (maps the user can't pan, like the place preview)
 * @param {number} [homeZoom]
 */
export function RouteLine({ positions, home, homeZoom }) {
  const map = useMap()
  const hasLine = Boolean(positions && positions.length >= 2)
  const [homeLat, homeLng] = home || []

  useEffect(() => {
    if (!hasLine || homeLat == null) return
    // Skip when the whole map is unmounting: Leaflet has already torn it down
    return () => { if (map._mapPane) map.setView([homeLat, homeLng], homeZoom, { animate: false }) }
  }, [map, hasLine, homeLat, homeLng, homeZoom])

  // Credit ORS only while a route is drawn. Maps built without an
  // attribution control (the place preview) get a small one for the duration.
  useEffect(() => {
    if (!hasLine) return
    if (map.attributionControl) {
      map.attributionControl.addAttribution(ORS_ATTRIBUTION)
      return () => { map.attributionControl?.removeAttribution(ORS_ATTRIBUTION) }
    }
    const control = L.control.attribution({ prefix: false }).addAttribution(ORS_ATTRIBUTION).addTo(map)
    control.getContainer()?.classList.add('route-attribution')
    return () => { control.remove() }
  }, [map, hasLine])

  useEffect(() => {
    if (!positions || positions.length < 2) return
    // Room at the top for the pin (~48px above its point) and at the bottom
    // for the attribution strip.
    map.fitBounds(positions, { paddingTopLeft: [32, 56], paddingBottomRight: [32, 40], maxZoom: 16 })
  }, [map, positions])

  if (!hasLine) return null
  return (
    <>
      <Polyline positions={positions} className="route-line-casing" pathOptions={{ weight: 8, lineCap: 'round', lineJoin: 'round', interactive: false }} />
      <Polyline positions={positions} className="route-line" pathOptions={{ weight: 5, lineCap: 'round', lineJoin: 'round', interactive: false }} />
    </>
  )
}

export function RouteChip({ route, onClear, onRetry, className = '' }) {
  const formatDistance = useFormatDistance()
  const { main, note } = routeSummary(route, formatDistance)
  const place = route?.to?.name

  return (
    <div className={`route-chip-region ${className}`} aria-live="polite" aria-atomic="true">
      {route && (
        <div className="route-chip" data-status={route.status}>
          <span className="route-chip-swatch" aria-hidden="true" />
          <span className="route-chip-text">
            <span className="route-chip-main">{main}</span>
            {place && route.status === 'ready' && <span className="route-chip-place"> to {place}</span>}
            {note && <span className="route-chip-note">{note}</span>}
          </span>
          {route.canRetry && onRetry && (
            <button type="button" className="route-chip-btn" onClick={() => onRetry(route)}>
              Try again
            </button>
          )}
          {route.canOpenSettings && (
            <button type="button" className="route-chip-btn" onClick={() => import('../../utils/nativePlugins').then(m => m.openAppSettings())}>
              Open Settings
            </button>
          )}
          {route.status !== 'loading' && (
            <button
              type="button"
              className="route-chip-btn"
              // No real origin (error state): omit it and the Maps app uses its own location
              onClick={() => openMapsDirections({ from: route.status === 'ready' ? route.from : undefined, to: route.to, mode: route.mode })}
              aria-label={`Open in Maps${place ? `, directions to ${place}` : ''}`}
            >
              Open in Maps
            </button>
          )}
          <button type="button" className="route-chip-clear" onClick={onClear} aria-label="Clear route">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
