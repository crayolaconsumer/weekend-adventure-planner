/**
 * DiscoverMap Component
 *
 * Interactive map view for discovering places on desktop.
 * Uses Leaflet for mapping with custom styled markers.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { motion } from 'framer-motion'
import { GOOD_CATEGORIES } from '../utils/categories'
import 'leaflet/dist/leaflet.css'
import './DiscoverMap.css'

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
    const invalidate = () => map.invalidateSize()

    // Multiple attempts to catch layout settling
    invalidate()
    const t1 = setTimeout(invalidate, 100)
    const t2 = setTimeout(invalidate, 300)
    const t3 = setTimeout(() => {
      invalidate()
      onReady?.(map)
    }, 500)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
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

// Place popup content
function PlacePopup({ place, onSelect }) {
  const category = place.category || GOOD_CATEGORIES[place.categoryKey]

  return (
    <div className="map-popup-content">
      {place.photo && (
        <div className="map-popup-image">
          <img src={place.photo} alt={place.name} />
        </div>
      )}
      <div className="map-popup-info">
        {category && (
          <span className="map-popup-category" style={{ '--cat-color': category.color }}>
            {category.icon} {category.label}
          </span>
        )}
        <h4 className="map-popup-name">{place.name}</h4>
        {place.distance && (
          <span className="map-popup-distance">
            {place.distance < 1 ? `${Math.round(place.distance * 1000)}m` : `${place.distance.toFixed(1)}km`}
          </span>
        )}
        <button className="map-popup-btn" onClick={() => onSelect(place)}>
          View Details
        </button>
      </div>
    </div>
  )
}

export default function DiscoverMap({
  places,
  userLocation,
  selectedPlace,
  onSelectPlace,
  onBoundsChange
}) {
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const mapInstanceRef = useRef(null)
  const [tileUrl, setTileUrl] = useState(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
  )
  const [tileAttribution, setTileAttribution] = useState('&copy; <a href="https://carto.com/">CARTO</a>')
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
                <PlacePopup place={place} onSelect={onSelectPlace} />
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
      </div>
    </motion.div>
  )
}
