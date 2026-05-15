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
import PlaceImage from './PlaceImage'
import CategoryIcon from './icons/CategoryIcon'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { useBottomSheetDismiss } from '../hooks/useBottomSheetDismiss'
import { resolvePlaceImageSync, resolvePlaceImageAsync } from '../utils/placeImage'
import { tap as hapticTap, success as hapticSuccess } from '../utils/haptics'
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

const REASON_ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

/* Lucide "map-pin" — distance reason icon */
const NearbyIcon = () => (
  <svg {...REASON_ICON_PROPS}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

/* Lucide "sun" — good outdoor weather */
const SunIcon = () => (
  <svg {...REASON_ICON_PROPS}>
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2"/><path d="M12 20v2"/>
    <path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>
    <path d="M2 12h2"/><path d="M20 12h2"/>
    <path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
  </svg>
)

/* Lucide "home" — indoor option */
const HomeIcon = () => (
  <svg {...REASON_ICON_PROPS}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
)

/* Lucide "utensils" — lunch reason */
const UtensilsIcon = () => (
  <svg {...REASON_ICON_PROPS}>
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
    <path d="M7 2v20"/>
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
  </svg>
)

/* Lucide "moon" — dinner / evening reason */
const MoonIcon = () => (
  <svg {...REASON_ICON_PROPS}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
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

  // Distance — enhancePlace (placeFilter.js) sets place.distance in
  // KILOMETRES (calculateDistance uses R = 6371 km). The old code
  // assumed metres and was doubly wrong: the < 2000 check treated km
  // as metres (so ~always fired), then divided by 1000 again so a
  // place 1km away rendered as "Only 1m away". Now: surface the hint
  // when the place is genuinely close (within 5km) and pass distance
  // through formatDistance directly.
  if (typeof place.distance === 'number' && place.distance < 5) {
    reasons.push({
      icon: <NearbyIcon />,
      text: `Only ${formatDistance(place.distance)} away`
    })
  }

  // Weather match
  const isOutdoor = ['nature', 'active', 'entertainment'].includes(place.category?.key)
  if (context.weather?.isGood && isOutdoor) {
    reasons.push({ icon: <SunIcon />, text: 'Perfect weather for this' })
  } else if (!context.weather?.isGood && !isOutdoor) {
    reasons.push({ icon: <HomeIcon />, text: 'Great indoor option today' })
  }

  // Time of day
  const hour = new Date().getHours()
  if (hour >= 11 && hour <= 14 && place.category?.key === 'food') {
    reasons.push({ icon: <UtensilsIcon />, text: 'Perfect for lunch' })
  } else if (hour >= 18 && place.category?.key === 'food') {
    reasons.push({ icon: <MoonIcon />, text: 'Great for dinner' })
  }

  // Rating
  if (place.rating && place.rating >= 4.5) {
    reasons.push({
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
        </svg>
      ),
      text: 'Highly rated'
    })
  }

  // Category match (fallback)
  if (reasons.length < 2 && place.category) {
    reasons.push({
      icon: <CategoryIcon name={place.category.key} size="xs" />,
      text: `Popular ${place.category.label}`
    })
  }

  return reasons.slice(0, 3) // Max 3 reasons
}

// Confetti particles for celebration. Pre-computed at module load
// so each particle's x-trajectory + final rotation are stable across
// renders — calling Math.random() inside render() would re-roll them
// on every re-render (jittery animation) AND trips the React rules-
// of-purity lint rule.
const CONFETTI_PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  color: ['#1a3a2f', '#d4a855', '#7c9a82', '#ef4444', '#3b82f6'][i % 5],
  x: Math.random() * 200 - 100,
  rotate: Math.random() * 360,
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
  const formatDistance = useFormatDistance()
  const focusTrapRef = useFocusTrap(isOpen)
  // Swipe-down-to-dismiss. Disabled mid-celebration so the user
  // can't accidentally drag the confetti screen away.
  const dismissDrag = useBottomSheetDismiss(onClose, { enabled: !showCelebration })

  // Reset state when modal opens. React-recommended pattern from
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // — comparing prop-vs-prev during render gives a single batched
  // update instead of a separate effect-pass-render-pass cycle.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setCurrentIndex(0)
      setShowCelebration(false)
    }
  }

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
  useLockBodyScroll(isOpen)

  const current = recommendations[currentIndex]
  const reasons = useMemo(() =>
    current ? getRecommendationReasons(current, { weather }, formatDistance) : [],
    [current, weather, formatDistance]
  )

  // Pre-resolve the image URL for the current recommendation. The
  // recommendations passed in here are NOT the same merged-with-
  // enriched-images objects CardStack builds internally, so without
  // this step PlaceImage would re-do the async resolve each time the
  // modal opens. Resolving here once and passing the URL as src lets
  // the modal show the photo immediately for places that already
  // rendered with one on Discover. Falls back to PlaceImage's own
  // brand placeholder if no URL ever resolves.
  const [resolvedImage, setResolvedImage] = useState(() =>
    current ? resolvePlaceImageSync(current) : null
  )
  // Reset resolvedImage when `current` changes, in render (rather
  // than effect) — same React-recommended pattern as above. Sync
  // resolution happens here so the image swap is a single batched
  // update. Async resolution lives in the effect below.
  const [prevCurrent, setPrevCurrent] = useState(current)
  if (current !== prevCurrent) {
    setPrevCurrent(current)
    setResolvedImage(current ? resolvePlaceImageSync(current) : null)
  }
  useEffect(() => {
    if (!current) return
    const sync = resolvePlaceImageSync(current)
    if (sync) return  // already set during render above
    let cancelled = false
    resolvePlaceImageAsync(current).then((url) => {
      if (!cancelled && url) setResolvedImage(url)
    })
    return () => { cancelled = true }
  }, [current])

  const handleShowAnother = () => {
    hapticTap('light')
    setCurrentIndex((i) => (i + 1) % recommendations.length)
  }

  const handleLetsGo = () => {
    if (!current) return

    hapticSuccess()
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
          {...dismissDrag}
        >
          {!showCelebration ? (
            <>
              {/* Close button */}
              <button className="just-go-close" onClick={onClose} aria-label="Close">
                <CloseIcon />
              </button>

              {/* Header */}
              <div className="just-go-header">
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
                  {/* Hand the pre-resolved URL straight to PlaceImage so
                      it renders the same photo that Discover already
                      showed for this place. Without this the modal
                      re-ran the async resolve each time and frequently
                      stayed on the placeholder. */}
                  <PlaceImage
                    place={current}
                    src={resolvedImage || undefined}
                    alt={current.name}
                  />
                  {current.category && (
                    <span className="just-go-card-category">
                      <CategoryIcon name={current.category.key} size="xs" />
                      <span>{current.category.label}</span>
                    </span>
                  )}
                </div>

                <div className="just-go-card-content">
                  <h3 className="just-go-card-name">{current.name}</h3>

                  {/* Recommendation reasons */}
                  <div className="just-go-reasons">
                    {reasons.map((reason) => (
                      <span key={reason.text} className="just-go-reason">
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
                      rotate: p.rotate
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
