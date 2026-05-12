/**
 * VisitedMapLeaflet
 *
 * Real Leaflet map of a user's visited places. Pin colour-coded by
 * recommend status. Auto-fits to bounds, flies to focused pin.
 *
 * Tile URL matches the CARTO Voyager tiles used in DiscoverMap so the
 * visual identity is consistent across the app.
 */

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
import './VisitedMapLeaflet.css'
import { useTheme } from '../../contexts/ThemeContext'

// Voyager = warm paper-coloured CARTO tiles (matches light theme).
// Dark Matter = minimal dark tiles (matches dark theme). Both free,
// no API key, OSM-attributed.
const TILE_URL_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_URL_DARK = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
const ATTRIBUTION = '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function colorFor(rating) {
  if (rating == null) return '#94a3b8'
  if (rating > 3) return '#16a34a'
  return '#dc2626'
}

function FitToBounds({ places }) {
  const map = useMap()
  useEffect(() => {
    const valid = places.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number')
    if (valid.length === 0) return
    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lng], 12)
      return
    }
    const bounds = L.latLngBounds(valid.map(p => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
  }, [places, map])
  return null
}

function FlyToFocused({ places, focusedPlaceId }) {
  const map = useMap()
  useEffect(() => {
    if (!focusedPlaceId) return
    const place = places.find(p => p.placeId === focusedPlaceId)
    if (!place) return
    map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 14), { duration: 0.6 })
  }, [places, focusedPlaceId, map])
  return null
}

export default function VisitedMapLeaflet({ places, onPinTap, focusedPlaceId }) {
  const { resolved: theme } = useTheme()
  const tileUrl = theme === 'dark' ? TILE_URL_DARK : TILE_URL_LIGHT
  const normalizedPlaces = useMemo(
    () => (places || [])
      .map(p => {
        const data = p.placeData || p
        const lat = data?.lat
        const lng = data?.lng ?? data?.lon
        if (typeof lat !== 'number' || typeof lng !== 'number') return null
        return {
          placeId: p.placeId,
          lat,
          lng,
          name: data?.name,
          rating: p.rating
        }
      })
      .filter(Boolean),
    [places]
  )

  if (normalizedPlaces.length === 0) {
    return (
      <div className="visited-map-leaflet empty">
        <p>No mappable places yet</p>
      </div>
    )
  }

  return (
    <div className="visited-map-leaflet">
      <MapContainer
        center={[normalizedPlaces[0].lat, normalizedPlaces[0].lng]}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer url={tileUrl} attribution={ATTRIBUTION} detectRetina key={tileUrl} />
        <FitToBounds places={normalizedPlaces} />
        <FlyToFocused places={normalizedPlaces} focusedPlaceId={focusedPlaceId} />
        <MarkerClusterGroup chunkedLoading maxClusterRadius={45}>
          {normalizedPlaces.map(place => {
            const isFocused = focusedPlaceId === place.placeId
            return (
              <CircleMarker
                key={place.placeId}
                center={[place.lat, place.lng]}
                radius={isFocused ? 10 : 7}
                pathOptions={{
                  color: colorFor(place.rating),
                  fillColor: colorFor(place.rating),
                  fillOpacity: isFocused ? 0.9 : 0.7,
                  weight: isFocused ? 3 : 2
                }}
                eventHandlers={{
                  click: () => onPinTap?.(place.placeId)
                }}
              >
                {place.name && <Tooltip>{place.name}</Tooltip>}
              </CircleMarker>
            )
          })}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  )
}
