import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { getBoundingBox } from '../../utils/statsUtils'
import { GOOD_CATEGORIES } from '../../utils/categories'
import './stats.css'

export default function VisitedMap({ places }) {
  const mapData = useMemo(() => {
    // Filter places with valid coordinates
    const validPlaces = places.filter(p => p.lat && p.lng)
    if (validPlaces.length === 0) return null

    const bounds = getBoundingBox(validPlaces)
    if (!bounds) return null

    // Add padding to bounds
    const latPadding = Math.max((bounds.maxLat - bounds.minLat) * 0.1, 0.001)
    const lngPadding = Math.max((bounds.maxLng - bounds.minLng) * 0.1, 0.001)

    const paddedBounds = {
      minLat: bounds.minLat - latPadding,
      maxLat: bounds.maxLat + latPadding,
      minLng: bounds.minLng - lngPadding,
      maxLng: bounds.maxLng + lngPadding
    }

    const latRange = paddedBounds.maxLat - paddedBounds.minLat
    const lngRange = paddedBounds.maxLng - paddedBounds.minLng

    // Map places to percentage positions
    const mappedPlaces = validPlaces.map(place => {
      const category = GOOD_CATEGORIES[place.category]
      return {
        ...place,
        x: ((place.lng - paddedBounds.minLng) / lngRange) * 100,
        y: ((paddedBounds.maxLat - place.lat) / latRange) * 100, // Invert Y for screen coords
        color: category?.color || '#888',
        icon: category?.icon || '📍'
      }
    })

    return {
      places: mappedPlaces,
      bounds: paddedBounds
    }
  }, [places])

  if (!mapData) {
    return (
      <div className="stats-card visited-map empty">
        <h3 className="stats-card-title">Your Map</h3>
        <p className="stats-empty">Your visited places will appear here</p>
        <div className="map-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
            <line x1="9" y1="3" x2="9" y2="18"/>
            <line x1="15" y1="6" x2="15" y2="21"/>
          </svg>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      className="stats-card visited-map"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h3 className="stats-card-title">Your Map</h3>

      <div className="map-container">
        <div className="map-grid">
          {/* Grid lines for visual reference */}
          <div className="map-grid-line horizontal" style={{ top: '25%' }} />
          <div className="map-grid-line horizontal" style={{ top: '50%' }} />
          <div className="map-grid-line horizontal" style={{ top: '75%' }} />
          <div className="map-grid-line vertical" style={{ left: '25%' }} />
          <div className="map-grid-line vertical" style={{ left: '50%' }} />
          <div className="map-grid-line vertical" style={{ left: '75%' }} />
        </div>

        <div className="map-dots">
          {mapData.places.map((place, index) => (
            <motion.div
              key={place.id}
              className="map-dot"
              style={{
                left: `${place.x}%`,
                top: `${place.y}%`,
                backgroundColor: place.color
              }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: index * 0.05, type: 'spring', stiffness: 400 }}
              title={place.name}
            >
              <span className="map-dot-pulse" style={{ backgroundColor: place.color }} />
            </motion.div>
          ))}
        </div>
      </div>

      <div className="map-footer">
        <span className="map-count">{mapData.places.length} places explored</span>
      </div>
    </motion.div>
  )
}
