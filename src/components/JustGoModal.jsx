/**
 * Just Go Modal
 *
 * Anti-procrastination feature that shows ONE personalized recommendation
 * with contextual reasons and a commitment flow.
 */

import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useFormatDistance } from '../contexts/DistanceContext'
import { openDirections } from '../utils/navigation'
import './JustGoModal.css'

// Icons (use simple SVGs matching existing app patterns)
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const ShuffleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 3 21 3 21 8"/>
    <line x1="4" y1="20" x2="21" y2="3"/>
    <polyline points="21 16 21 21 16 21"/>
    <line x1="15" y1="15" x2="21" y2="21"/>
    <line x1="4" y1="4" x2="9" y2="9"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

/**
 * Get recommendation reasons based on context
 * @param {object} place - The place object
 * @param {object} context - Context with weather info
 * @param {function} formatDistance - Distance formatting function
 * @returns {Array} Array of reason objects with icon and text
 */
function getRecommendationReasons(place, context, formatDistance) {
  const reasons = []

  // Distance (if close) - place.distance is in meters, formatDistance expects km
  if (place.distance && place.distance < 2000) {
    const distanceKm = place.distance / 1000
    reasons.push({
      icon: '📍',
      text: `Only ${formatDistance(distanceKm)} away`
    })
  }

  // Weather match
  const isOutdoor = ['nature', 'active', 'entertainment'].includes(place.category?.key)
  if (context.weather?.isGood && isOutdoor) {
    reasons.push({ icon: '☀️', text: 'Perfect weather for this' })
  } else if (!context.weather?.isGood && !isOutdoor) {
    reasons.push({ icon: '🏠', text: 'Great indoor option today' })
  }

  // Time of day
  const hour = new Date().getHours()
  if (hour >= 11 && hour <= 14 && place.category?.key === 'food') {
    reasons.push({ icon: '🍽️', text: 'Perfect for lunch' })
  } else if (hour >= 18 && place.category?.key === 'food') {
    reasons.push({ icon: '🌙', text: 'Great for dinner' })
  }

  // Rating
  if (place.rating && place.rating >= 4.5) {
    reasons.push({ icon: '⭐', text: 'Highly rated' })
  }

  // Category match (fallback)
  if (reasons.length < 2 && place.category) {
    reasons.push({ icon: place.category.icon || '✨', text: `Popular ${place.category.label}` })
  }

  return reasons.slice(0, 3) // Max 3 reasons
}

// Confetti particles for celebration
const CONFETTI_PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  color: ['#1a3a2f', '#d4a855', '#7c9a82', '#ef4444', '#3b82f6'][i % 5],
  x: Math.random() * 200 - 100,
  delay: i * 0.03
}))

export default function JustGoModal({
  isOpen,
  onClose,
  recommendations = [],
  weather,
  onGo
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showCelebration, setShowCelebration] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const formatDistance = useFormatDistance()
  const focusTrapRef = useFocusTrap(isOpen)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0)
      setShowCelebration(false)
      setImageLoaded(false)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen && !showCelebration) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, showCelebration, onClose])

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const current = recommendations[currentIndex]
  const reasons = useMemo(() =>
    current ? getRecommendationReasons(current, { weather }, formatDistance) : [],
    [current, weather, formatDistance]
  )

  const handleShowAnother = () => {
    setImageLoaded(false)
    setCurrentIndex((i) => (i + 1) % recommendations.length)
  }

  const handleLetsGo = () => {
    if (!current) return

    setShowCelebration(true)

    // Callback to parent
    onGo?.(current)

    // Open directions after celebration
    setTimeout(() => {
      openDirections(current.lat, current.lng, current.name)
      onClose()
    }, 1800)
  }

  if (!isOpen) return null

  // No recommendations available
  if (recommendations.length === 0) {
    return (
      <motion.div
        className="just-go-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="just-go-modal just-go-empty" onClick={e => e.stopPropagation()}>
          <button className="just-go-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
          <div className="just-go-empty-content">
            <span className="just-go-empty-icon">🔍</span>
            <h2>No recommendations yet</h2>
            <p>Keep swiping to help us learn your taste!</p>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <AnimatePresence>
      <motion.div
        className="just-go-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={!showCelebration ? onClose : undefined}
      >
        <motion.div
          ref={focusTrapRef}
          className="just-go-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="just-go-title"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={e => e.stopPropagation()}
        >
          {!showCelebration ? (
            <>
              {/* Close button */}
              <button className="just-go-close" onClick={onClose} aria-label="Close">
                <CloseIcon />
              </button>

              {/* Header */}
              <div className="just-go-header">
                <span className="just-go-header-icon">🎯</span>
                <h2 id="just-go-title">Perfect for right now</h2>
              </div>

              {/* Place Card */}
              <motion.div
                className="just-go-card"
                key={current.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="just-go-card-image">
                  {!imageLoaded && <div className="just-go-image-placeholder" />}
                  <img
                    src={current.image || current.photo || `https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80`}
                    alt={current.name}
                    onLoad={() => setImageLoaded(true)}
                    onError={(e) => {
                      e.target.src = 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80'
                      setImageLoaded(true)
                    }}
                    className={imageLoaded ? 'loaded' : ''}
                  />
                  {current.category && (
                    <span className="just-go-card-category">
                      {current.category.icon} {current.category.label}
                    </span>
                  )}
                </div>

                <div className="just-go-card-content">
                  <h3 className="just-go-card-name">{current.name}</h3>

                  {/* Recommendation reasons */}
                  <div className="just-go-reasons">
                    {reasons.map((reason) => (
                      <span key={`${reason.icon}-${reason.text}`} className="just-go-reason">
                        <span className="just-go-reason-icon">{reason.icon}</span>
                        {reason.text}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>

              {/* Actions */}
              <div className="just-go-actions">
                <button
                  className="just-go-btn-secondary"
                  onClick={handleShowAnother}
                  disabled={recommendations.length <= 1}
                >
                  <ShuffleIcon />
                  <span>Show Another</span>
                  <span className="just-go-counter">{currentIndex + 1}/{recommendations.length}</span>
                </button>

                <motion.button
                  className="just-go-btn-primary"
                  onClick={handleLetsGo}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <NavigationIcon />
                  <span>Let's Go!</span>
                </motion.button>
              </div>
            </>
          ) : (
            /* Celebration */
            <motion.div
              className="just-go-celebration"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {/* Confetti */}
              <div className="just-go-confetti">
                {CONFETTI_PARTICLES.map(p => (
                  <motion.div
                    key={p.id}
                    className="confetti-particle"
                    style={{ backgroundColor: p.color }}
                    initial={{ y: 0, x: 0, opacity: 1 }}
                    animate={{
                      y: 300,
                      x: p.x,
                      opacity: 0,
                      rotate: Math.random() * 360
                    }}
                    transition={{
                      duration: 1.5,
                      delay: p.delay,
                      ease: 'easeOut'
                    }}
                  />
                ))}
              </div>

              <motion.div
                className="just-go-celebration-icon"
                animate={{
                  rotate: [0, 10, -10, 0],
                  scale: [1, 1.2, 1]
                }}
                transition={{ duration: 0.5, repeat: 2 }}
              >
                🎉
              </motion.div>
              <h2>Adventure awaits!</h2>
              <p>Opening directions to {current?.name || 'your destination'}...</p>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
