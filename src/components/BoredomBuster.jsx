import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { openDirections } from '../utils/navigation'
import './BoredomBuster.css'

const NavigationIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const RefreshIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,12a9,9,0,1,1-2.64-6.36"/>
    <polyline points="21,3 21,9 15,9"/>
  </svg>
)

const XIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

// Category-specific placeholder images (high-res for retina displays)
const CATEGORY_IMAGES = {
  food: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=1600&q=85&auto=format&fit=crop',
  nature: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=85&auto=format&fit=crop',
  culture: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=1600&q=85&auto=format&fit=crop',
  historic: 'https://images.unsplash.com/photo-1548013146-72479768bada?w=1600&q=85&auto=format&fit=crop',
  entertainment: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&q=85&auto=format&fit=crop',
  nightlife: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1600&q=85&auto=format&fit=crop',
  active: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&q=85&auto=format&fit=crop',
  unique: 'https://images.unsplash.com/photo-1569701813229-33284b643e3c?w=1600&q=85&auto=format&fit=crop',
  shopping: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=1600&q=85&auto=format&fit=crop',
  default: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1600&q=85&auto=format&fit=crop'
}

export default function BoredomBuster({
  place,
  weather,
  loading = false,
  onRefresh,
  onGo,
  onClose
}) {
  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Handle keyboard escape to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const getReasonText = () => {
    if (!weather || !place) return "A perfect spot for right now"

    const reasons = []

    // Weather-based reasons
    if (weather.weatherCode <= 3) {
      if (place.category?.key === 'nature' || place.category?.key === 'active') {
        reasons.push("Perfect weather for the outdoors")
      }
    } else {
      if (place.category?.key === 'culture' || place.category?.key === 'food') {
        reasons.push("Great indoor escape from the weather")
      }
    }

    // Time-based reasons
    const hour = new Date().getHours()
    if (hour < 12 && place.category?.key === 'food') {
      reasons.push("Start your day with a treat")
    } else if (hour >= 17 && place.category?.key === 'nightlife') {
      reasons.push("Perfect evening vibes")
    } else if (hour >= 12 && hour < 17 && place.category?.key === 'culture') {
      reasons.push("Ideal afternoon activity")
    }

    // Distance-based
    if (place.distance && place.distance < 1) {
      reasons.push("Just a short walk away")
    } else if (place.distance && place.distance < 3) {
      reasons.push("Quick trip from here")
    }

    return reasons[0] || "A perfect spot for right now"
  }

  const handleGo = () => {
    onGo?.(place)
    if (place) {
      openDirections(place.lat, place.lng, place.name)
    }
  }

  const imageUrl = place?.photo || place?.image || CATEGORY_IMAGES[place?.category?.key] || CATEGORY_IMAGES.default

  return (
    <AnimatePresence>
      <motion.div
        className="boredom-buster"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Background Image */}
        <div
          className="boredom-buster-bg"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
        <div className="boredom-buster-overlay" />

        {/* Close Button */}
        <button className="boredom-buster-close" onClick={onClose} aria-label="Close boredom buster">
          <XIcon />
        </button>

        {/* Content */}
        <motion.div
          className="boredom-buster-content"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {loading ? (
            <div className="boredom-buster-loading">
              <div className="loading-dice">🎲</div>
              <p>Finding your next adventure<span className="loading-dots"><span></span><span></span><span></span></span></p>
              <button className="boredom-buster-cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          ) : place ? (
            <>
              <span className="boredom-buster-reason">{getReasonText()}</span>

              {place.category && (
                <span className="boredom-buster-category">
                  <span>{place.category.icon}</span>
                  {place.category.label}
                </span>
              )}

              <h1 className="boredom-buster-name">{place.name}</h1>

              <div className="boredom-buster-meta">
                {place.distance && (
                  <span>{place.distance < 1 ? `${Math.round(place.distance * 1000)}m` : `${place.distance.toFixed(1)}km`} away</span>
                )}
                {place.type && (
                  <span className="boredom-buster-type">{place.type.replace(/_/g, ' ')}</span>
                )}
              </div>

              {place.description && (
                <p className="boredom-buster-description">"{place.description}"</p>
              )}

              <div className="boredom-buster-actions">
                <button className="boredom-buster-go" onClick={handleGo}>
                  <NavigationIcon />
                  <span>Let's Go</span>
                </button>

                <button className="boredom-buster-refresh" onClick={onRefresh}>
                  <RefreshIcon />
                  <span>Try Another</span>
                </button>
              </div>
            </>
          ) : (
            <div className="boredom-buster-error">
              <p>Couldn't find a place nearby. Try again?</p>
              <button className="btn btn-ghost" onClick={onRefresh}>
                <RefreshIcon />
                Try Again
              </button>
            </div>
          )}
        </motion.div>

        {/* Weather info */}
        {weather && (
          <div className="boredom-buster-weather">
            <span>{Math.round(weather.temperature)}°</span>
            <span>{weather.description}</span>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
