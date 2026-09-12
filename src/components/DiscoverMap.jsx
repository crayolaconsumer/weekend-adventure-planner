/**
 * DiscoverMap Component
 *
 * Interactive map view for discovering places on desktop.
 * Uses Leaflet for mapping with custom styled markers.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { motion } from 'framer-motion'
import { GOOD_CATEGORIES } from '../utils/categories'
import CategoryIcon from './icons/CategoryIcon'
import PlaceImage from './PlaceImage'
import { useFormatDistance } from '../contexts/DistanceContext'
import 'leaflet/dist/leaflet.css'
import './DiscoverMap.css'
import { useTheme } from '../contexts/ThemeContext'

// Fix Leaflet's default icon path issue with bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Create custom marker icon based on category
function createCategoryIcon(category) {
  const color = category?.color || '#64748b'
  const icon = category?.icon || '📍'

  return L.divIcon({
    className: 'discover-map-marker',
    html: `
      <div class="marker-pin" style="--marker-color: ${color}">
        <span class="marker-icon">${icon}</span>
      </div>
    `,
    iconSize: [40, 48],
    iconAnchor: [20, 48],
    popupAnchor: [0, -48]
  })
}

// Create user location marker
function createUserIcon() {
  return L.divIcon({
    className: 'discover-map-user-marker',
    html: `<div class="user-marker-dot"><div class="user-marker-pulse"></div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  })
}

// Map controls component to handle map interactions
function MapController({ center, onBoundsChange, onReady }) {
  const map = useMap()

  useEffect(() => {
    if (center) {
      map.setView([center.lat, center.lng], map.getZoom())
    }
  }, [center, map])

  useEffect(() => {
    const invalidate = () => {
      map.invalidateSize({ animate: false, pan: false })
      // Also trigger window resize as fallback
      window.dispatchEvent(new Event('resize'))
    }

    // Multiple attempts to catch layout settling
    const t0 = setTimeout(invalidate, 0)
    const t1 = setTimeout(invalidate, 50)
    const t2 = setTimeout(invalidate, 150)
    const t3 = setTimeout(invalidate, 300)
    const t4 = setTimeout(() => {
      invalidate()
      onReady?.(map)
    }, 500)

    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
    }
  }, [map, onReady])

  useMapEvents({
    moveend: () => {
      const bounds = map.getBounds()
      onBoundsChange?.({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      })
    }
  })

  return null
}

// Fit the map to a freshly loaded route (premium Google directions)
function RouteController({ positions }) {
  const map = useMap()

  useEffect(() => {
    if (!positions || positions.length < 2) return
    map.fitBounds(positions, { padding: [48, 48], maxZoom: 16 })
  }, [map, positions])

  return null
}

// Place popup content
function PlacePopup({ place, onSelect, onDirections, formatDistance }) {
  const category = place.category || GOOD_CATEGORIES[place.categoryKey]

  return (
    <div className="map-popup-content">
      {/* Shared PlaceImage so the map popup resolves the same real photo
          (with brand placeholder fallback) as the card/list/detail. */}
      <div className="map-popup-image">
        <PlaceImage place={place} src={place.photo || undefined} alt={place.name} />
      </div>
      <div className="map-popup-info">
        {category && (
          <span className="map-popup-category" style={{ '--cat-color': category.color }}>
            <CategoryIcon name={category.key} size="xs" /> {category.label}
          </span>
        )}
        <h4 className="map-popup-name">{place.name}</h4>
        {place.distance && (
          <span className="map-popup-distance">
            {formatDistance(place.distance)}
          </span>
        )}
        <div className="map-popup-actions">
          <button className="map-popup-btn" onClick={() => onSelect(place)}>
            View Details
          </button>
          {onDirections && (
            <button
              className="map-popup-btn map-popup-btn-secondary"
              onClick={() => onDirections(place)}
              aria-label={`Show directions to ${place.name}`}
            >
              Directions
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * @param {Object} props
 * @param {Array} props.places - Places to render as markers
 * @param {Object} [props.userLocation] - { lat, lng }
 * @param {Object} [props.selectedPlace] - Currently selected place (opens its popup)
 * @param {Function} [props.onSelectPlace] - Called when a marker/popup is selected
 * @param {Function} [props.onBoundsChange] - Called when the viewport changes
 * @param {Function} [props.onRequestDirections] - Called with a place when the user asks
 *   for directions (premium: fetches Google route; free: shows upgrade prompt)
 * @param {Object} [props.route] - Google route to draw (premium only):
 *   { positions: [[lat,lng],...], place, durationText, summary, loading }
 * @param {Function} [props.onClearRoute] - Removes the drawn route
 */
export default function DiscoverMap({
  places,
  userLocation,
  selectedPlace,
  onSelectPlace,
  onBoundsChange,
  onRequestDirections,
  route,
  onClearRoute
}) {
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const mapInstanceRef = useRef(null)
  const formatDistance = useFormatDistance()
  const { resolved: theme } = useTheme()
  // Theme picks the initial tile URL. The fallback at handleTileError
  // below swaps to plain OSM if CARTO ever fails 3x. Re-derive when
  // theme flips so a runtime toggle updates the map immediately.
  const [tileUrl, setTileUrl] = useState(
    theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
  )
  const [tileAttribution, setTileAttribution] = useState('&copy; <a href="https://carto.com/">CARTO</a>')
  // Keep tile URL in sync with theme changes. Reset-in-render pattern
  // (compare prev-vs-current) avoids the setState-in-effect cascade.
  const [prevTheme, setPrevTheme] = useState(theme)
  if (theme !== prevTheme) {
    setPrevTheme(theme)
    setTileUrl(theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png')
  }
  const tileErrorCountRef = useRef(0)

  // Calculate map center
  const center = userLocation || (places[0] ? { lat: places[0].lat, lng: places[0].lng } : { lat: 51.5074, lng: -0.1278 })

  // Handle marker click
  const handleMarkerClick = useCallback((place) => {
    onSelectPlace?.(place)
  }, [onSelectPlace])

  // Fly to selected place
  useEffect(() => {
    if (selectedPlace && mapRef.current) {
      const marker = markersRef.current[selectedPlace.id]
      if (marker) {
        marker.openPopup()
      }
    }
  }, [selectedPlace])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const timeout = setTimeout(() => {
      map.invalidateSize()
    }, 200)

    return () => clearTimeout(timeout)
  }, [places.length])

  const handleTileError = useCallback(() => {
    tileErrorCountRef.current += 1
    if (tileErrorCountRef.current === 3) {
      setTileUrl('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
      setTileAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>')
    }
  }, [])

  return (
    <motion.div
      className="discover-map-container"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={14}
        className="discover-map"
        ref={mapRef}
        zoomControl={false}
      >
        {/* Dark/stylized map tiles */}
        <TileLayer
          attribution={tileAttribution}
          url={tileUrl}
          detectRetina
          crossOrigin="anonymous"
          eventHandlers={{
            tileerror: handleTileError
          }}
        />

        <MapController
          center={center}
          onBoundsChange={onBoundsChange}
          onReady={(map) => {
            mapInstanceRef.current = map
          }}
        />

        {/* User location marker */}
        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={createUserIcon()}
          />
        )}

        {/* Premium: Google Directions route polyline */}
        {route?.positions?.length > 1 && (
          <>
            {/* Casing (outline) under the main line for contrast on light tiles */}
            <Polyline
              positions={route.positions}
              pathOptions={{
                color: '#ffffff',
                weight: 8,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false
              }}
            />
            <Polyline
              positions={route.positions}
              className="discover-map-route"
              pathOptions={{
                color: '#c45c3e', // --roam-terracotta
                weight: 5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false
              }}
            />
            <RouteController positions={route.positions} />
          </>
        )}

        {/* Place markers */}
        {places.map((place) => {
          const category = place.category || GOOD_CATEGORIES[place.categoryKey]
          return (
            <Marker
              key={place.id}
              position={[place.lat, place.lng]}
              icon={createCategoryIcon(category)}
              ref={(ref) => { if (ref) markersRef.current[place.id] = ref }}
              eventHandlers={{
                click: () => handleMarkerClick(place)
              }}
            >
              <Popup className="discover-map-popup">
                <PlacePopup
                  place={place}
                  onSelect={onSelectPlace}
                  onDirections={onRequestDirections}
                  formatDistance={formatDistance}
                />
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>

      {/* Map legend */}
      <div className="discover-map-legend">
        <span className="map-legend-item">
          <span className="map-legend-count">{places.length}</span> places
        </span>
        {route && (
          <span className="map-legend-item map-legend-route" aria-live="polite">
            <span className="map-legend-route-swatch" aria-hidden="true" />
            {route.loading ? (
              <span>Finding route…</span>
            ) : (
              <span>
                <span className="map-legend-count">{route.durationText}</span>
                {route.summary ? ` · ${route.summary}` : ''}
                {route.place?.name ? ` to ${route.place.name}` : ''}
              </span>
            )}
            {onClearRoute && (
              <button
                type="button"
                className="map-legend-route-clear"
                onClick={onClearRoute}
                aria-label="Clear route"
              >
                ×
              </button>
            )}
          </span>
        )}
      </div>
    </motion.div>
  )
}
