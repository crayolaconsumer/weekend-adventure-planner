/**
 * MapPreview - Quick location preview without triggering visit flow
 *
 * Shows a static map with the place pinned, basic info, and a link
 * to get directions. Does NOT trigger the "did you visit" prompt.
 */

import { motion } from 'framer-motion'
import { openDirections } from '../utils/navigation'
import './MapPreview.css'

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11"/>
  </svg>
)

const ExpandIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
  </svg>
)

export default function MapPreview({ place, onClose, onViewDetails }) {
  if (!place) return null

  const { lat, lng, name, type, distance, category } = place

  // Generate static map URL using OpenStreetMap tiles via a static map service
  // Using MapTiler static maps (free tier available)
  const mapUrl = `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=400&center=lonlat:${lng},${lat}&zoom=15&marker=lonlat:${lng},${lat};type:awesome;color:%23c45c3e;size:large&apiKey=demo`

  // Fallback to OpenStreetMap embed if static fails
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.008},${lng + 0.01},${lat + 0.008}&layer=mapnik&marker=${lat},${lng}`

  const formatDistance = (km) => {
    if (!km) return null
    if (km < 1) return `${Math.round(km * 1000)}m`
    return `${km.toFixed(1)}km`
  }

  const handleDirections = () => {
    openDirections(lat, lng, name)
    onClose()
  }

  return (
    <motion.div
      className="map-preview-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="map-preview-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="map-preview-header">
          <div className="map-preview-info">
            <h3 className="map-preview-name">{name}</h3>
            <div className="map-preview-meta">
              {category && <span className="map-preview-category">{category.icon} {category.label}</span>}
              {distance && <span className="map-preview-distance">{formatDistance(distance)} away</span>}
            </div>
          </div>
          <button className="map-preview-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Map */}
        <div className="map-preview-map">
          <iframe
            title={`Map showing ${name}`}
            src={osmEmbedUrl}
            className="map-preview-iframe"
            loading="lazy"
          />
        </div>

        {/* Actions */}
        <div className="map-preview-actions">
          <button className="map-preview-btn secondary" onClick={onViewDetails}>
            <ExpandIcon />
            <span>Full Details</span>
          </button>
          <button className="map-preview-btn primary" onClick={handleDirections}>
            <NavigationIcon />
            <span>Directions</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
