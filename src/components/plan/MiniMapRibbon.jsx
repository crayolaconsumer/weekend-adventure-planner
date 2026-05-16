/**
 * MiniMapRibbon — real Leaflet route map preview at the top of the
 * Plan-page itinerary.
 *
 * Draws each stop as a numbered branded pin (forest on cream, gold
 * for the currently-focused stop) over CARTO Voyager tiles, with a
 * dashed forest polyline connecting them in itinerary order. Reuses
 * the same tile + theme machinery as VisitedMapLeaflet so the visual
 * identity is consistent across every map surface in the app.
 *
 * Static-feel by default: scroll-wheel zoom + double-click zoom are
 * disabled (so scrolling the page doesn't zoom the map), but the user
 * can still pan / pinch / use the +/- controls for a closer look. The
 * map auto-fits to the route bounds with a small inset so the pins
 * never touch the edge.
 *
 * Toggleable: when the user collapses the ribbon we unmount the
 * MapContainer entirely (rather than hide via CSS height: 0) — that
 * avoids the well-known Leaflet "0-size, then visible" tile-render
 * bug where tiles never appear until invalidateSize() is called.
 */

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../../contexts/ThemeContext'
import { tap as hapticTap } from '../../utils/haptics'
import './MiniMapRibbon.css'

const TILE_URL_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_URL_DARK = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
const ATTRIBUTION = '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const FOREST = '#1a3a2f'
const GOLD = '#d4a855'

/**
 * Build a Leaflet divIcon that renders a numbered branded pin. Forest
 * background by default; gold for the active stop (so the user can
 * follow which card on the list maps to which pin on the map). The
 * surrounding cream border separates the pin from busy tile content.
 */
function makeNumberedIcon(number, isActive) {
  const bg = isActive ? GOLD : FOREST
  const fg = isActive ? FOREST : '#fdfcf8'
  // Hand-rolled SVG so the pin renders identically on every browser
  // and theme without depending on icon fonts. 32x32 viewBox with a
  // tear-drop body + numbered circle on top.
  return L.divIcon({
    className: 'plan-minimap-marker',
    html: `
      <span class="plan-minimap-marker-shadow"></span>
      <span class="plan-minimap-marker-body" style="background:${bg};color:${fg}">
        ${number}
      </span>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function FitToRoute({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13)
      return
    }
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 })
  }, [points, map])
  return null
}

function FlyToActive({ points, activeIndex }) {
  const map = useMap()
  useEffect(() => {
    if (activeIndex == null || activeIndex < 0) return
    const target = points[activeIndex]
    if (!target) return
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), { duration: 0.55 })
  }, [points, activeIndex, map])
  return null
}

export default function MiniMapRibbon({ stops = [], activeIndex = -1, onPinTap, expanded = true, onToggle }) {
  const { resolved: theme } = useTheme()
  const tileUrl = theme === 'dark' ? TILE_URL_DARK : TILE_URL_LIGHT

  const points = useMemo(
    () => (stops || [])
      .map((s, idx) => ({ idx, lat: Number(s.lat), lng: Number(s.lng ?? s.lon), name: s.name }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [stops]
  )

  if (points.length === 0) return null

  return (
    <div className={`plan-minimap ${expanded ? 'plan-minimap--expanded' : 'plan-minimap--collapsed'}`}>
      <button
        type="button"
        className="plan-minimap-toggle"
        onClick={() => { hapticTap('light'); onToggle?.() }}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide map' : 'Show map'}
      >
        <span className="plan-minimap-toggle-label">
          {expanded ? 'Hide map' : `Show map · ${points.length} stops`}
        </span>
        <span className={`plan-minimap-toggle-caret ${expanded ? 'open' : ''}`} aria-hidden="true">▾</span>
      </button>

      {/* Unmount when collapsed so Leaflet doesn't sit in a 0-height
          container and miss its initial tile fetch. The toggle stays
          rendered above so users can pop the map back open. */}
      {expanded && (
        <div className="plan-minimap-canvas">
          <MapContainer
            center={[points[0].lat, points[0].lng]}
            zoom={11}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            zoomControl={false}
            attributionControl={true}
          >
            <TileLayer url={tileUrl} attribution={ATTRIBUTION} detectRetina key={tileUrl} />
            <FitToRoute points={points} />
            <FlyToActive points={points} activeIndex={activeIndex} />
            {points.length > 1 && (
              <Polyline
                positions={points.map(p => [p.lat, p.lng])}
                pathOptions={{
                  color: FOREST,
                  weight: 3,
                  opacity: 0.78,
                  dashArray: '6 8',
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            )}
            {points.map((p, i) => (
              <Marker
                key={`${p.idx}-${i}`}
                position={[p.lat, p.lng]}
                icon={makeNumberedIcon(i + 1, i === activeIndex)}
                eventHandlers={{
                  click: () => { hapticTap('light'); onPinTap?.(p.idx) },
                }}
              />
            ))}
          </MapContainer>
        </div>
      )}

      {/* From → To caption — gives a textual anchor under the map and
          is still useful when the ribbon is collapsed. */}
      {points.length > 1 && (
        <div className="plan-minimap-caption">
          <span className="plan-minimap-caption-from">{points[0].name || 'Start'}</span>
          <span className="plan-minimap-caption-arrow" aria-hidden="true">→</span>
          <span className="plan-minimap-caption-to">{points[points.length - 1].name || 'End'}</span>
        </div>
      )}
    </div>
  )
}
