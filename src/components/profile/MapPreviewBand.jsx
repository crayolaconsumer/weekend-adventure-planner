import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { getBoundingBox } from '../../utils/statsUtils'
import { GOOD_CATEGORIES } from '../../utils/categories'
import './MapPreviewBand.css'

/**
 * Profile-header map preview band.
 * Stylized constellation of dots positioned by lat/lng with overlay count.
 * Whole band is interactive — parent wires onClick to navigate to /user/:username/map.
 */
export default function MapPreviewBand({ places, onClick, label = 'View map' }) {
  const mapData = useMemo(() => {
    // Accept either flat ({lat, lng}) shape or the nested
    // ({placeData: {lat, lng}}) shape that useVisitedPlaces stores. The
    // bug we hit before this fix: visited rows nested coords inside
    // placeData, the band filtered on top-level p.lat, every row was
    // dropped, the band rendered empty even when visits existed.
    const normalised = (places || []).map(p => {
      const data = p?.placeData || p || {}
      const lat = (typeof p?.lat === 'number') ? p.lat : data.lat
      const lng = (typeof p?.lng === 'number') ? p.lng :
                  (typeof p?.lon === 'number') ? p.lon :
                  data.lng ?? data.lon
      const category =
        (typeof p?.category === 'object' && p.category) ? p.category :
        (typeof data.category === 'object' && data.category) ? data.category :
        null
      return {
        id: p?.id || p?.placeId || data.id || data.placeId,
        lat,
        lng,
        category
      }
    })
    const validPlaces = normalised.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number')
    if (validPlaces.length === 0) return null

    const bounds = getBoundingBox(validPlaces)
    if (!bounds) return null

    const latPadding = Math.max((bounds.maxLat - bounds.minLat) * 0.1, 0.001)
    const lngPadding = Math.max((bounds.maxLng - bounds.minLng) * 0.1, 0.001)
    const padded = {
      minLat: bounds.minLat - latPadding,
      maxLat: bounds.maxLat + latPadding,
      minLng: bounds.minLng - lngPadding,
      maxLng: bounds.maxLng + lngPadding
    }
    const latRange = padded.maxLat - padded.minLat
    const lngRange = padded.maxLng - padded.minLng

    return {
      places: validPlaces.map(place => ({
        ...place,
        x: ((place.lng - padded.minLng) / lngRange) * 100,
        y: ((padded.maxLat - place.lat) / latRange) * 100,
        color: GOOD_CATEGORIES[place.category]?.color || '#1a3a2f'
      }))
    }
  }, [places])

  const count = mapData?.places?.length ?? 0
  const isEmpty = count === 0

  return (
    <button
      type="button"
      className={`map-preview-band ${isEmpty ? 'is-empty' : ''}`}
      onClick={onClick}
      aria-label={label}
    >
      <div className="map-preview-band-canvas">
        <div className="map-preview-grid">
          <div className="map-preview-grid-line horizontal" style={{ top: '33%' }} />
          <div className="map-preview-grid-line horizontal" style={{ top: '66%' }} />
          <div className="map-preview-grid-line vertical" style={{ left: '33%' }} />
          <div className="map-preview-grid-line vertical" style={{ left: '66%' }} />
        </div>
        <div className="map-preview-dots">
          {mapData?.places?.map((place, i) => (
            <motion.div
              key={place.id || `${place.lat}-${place.lng}-${i}`}
              className="map-preview-dot"
              style={{
                left: `${place.x}%`,
                top: `${place.y}%`,
                backgroundColor: place.color
              }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: Math.min(i * 0.03, 1.5), type: 'spring', stiffness: 400 }}
            />
          ))}
        </div>
      </div>
      <div className="map-preview-overlay">
        {isEmpty ? (
          <span className="map-preview-empty-hint">Start visiting places to grow your map</span>
        ) : (
          <>
            <span className="map-preview-count">{count}</span>
            <span className="map-preview-count-label">
              {count === 1 ? 'place visited' : 'places visited'}
            </span>
          </>
        )}
      </div>
    </button>
  )
}
