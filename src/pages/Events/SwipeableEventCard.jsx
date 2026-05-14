import { useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
import { formatEventDate, formatPriceRange, getSourceInfo } from '../../utils/eventsApi'
import { getEventPlaceholderImage } from './placeholderImage'
import { XIcon, HeartIcon, TicketIcon, CalendarSmallIcon, MapPinIcon } from './icons'

/**
 * Tinder-style swipeable card for an event.
 *
 *   - Swipe / drag right (or tap heart): "like" → saves to wishlist
 *   - Swipe / drag left  (or tap X):    "nope" → dismiss
 *   - Swipe / drag up    (or tap ticket): "go" → opens ticket URL
 *
 * Mirrors the design of SwipeCard for places so the brand feels coherent
 * across both surfaces. The `isTop` prop turns drag handling on/off so
 * cards stacked underneath the active one don't intercept gestures.
 */
export default function SwipeableEventCard({ event, onSwipe, onTap, style, isTop = false }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [hasMoved, setHasMoved] = useState(false)

  const x = useMotionValue(0)
  const y = useMotionValue(0)

  const sourceInfo = getSourceInfo(event.source)
  const imageUrl = event.imageUrl || getEventPlaceholderImage(event.id, event.categories)

  // Transform values based on drag
  const rotate = useTransform(x, [-200, 200], [-15, 15])
  const likeOpacity = useTransform(x, [0, 100], [0, 1])
  const nopeOpacity = useTransform(x, [-100, 0], [1, 0])
  const goOpacity = useTransform(y, [-100, 0], [1, 0])

  // Drag gesture handler - matches SwipeCard
  const bind = useDrag(
    ({ active, movement: [mx, my], direction: [dx, dy], velocity: [vx, vy] }) => {
      setIsDragging(active)

      if (active) {
        x.set(mx)
        y.set(my)
        if (Math.abs(mx) > 10 || Math.abs(my) > 10) {
          setHasMoved(true)
        }
      } else {
        setTimeout(() => setHasMoved(false), 50)
        const swipeThreshold = 100
        const velocityThreshold = 0.5

        if (mx > swipeThreshold || (vx > velocityThreshold && dx > 0)) {
          animate(x, 500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('like', event), 200)
        } else if (mx < -swipeThreshold || (vx > velocityThreshold && dx < 0)) {
          animate(x, -500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('nope', event), 200)
        } else if (my < -swipeThreshold || (vy > velocityThreshold && dy < 0)) {
          animate(y, -500, { duration: 0.3 })
          setTimeout(() => onSwipe?.('go', event), 200)
        } else {
          animate(x, 0, { type: 'spring', stiffness: 300, damping: 30 })
          animate(y, 0, { type: 'spring', stiffness: 300, damping: 30 })
        }
      }
    },
    { enabled: isTop },
  )

  const handleButtonClick = (action) => {
    if (action === 'like') {
      animate(x, 500, { duration: 0.3 })
    } else if (action === 'nope') {
      animate(x, -500, { duration: 0.3 })
    } else if (action === 'go') {
      animate(y, -500, { duration: 0.3 })
    }
    setTimeout(() => onSwipe?.(action, event), 200)
  }

  const handleCardClick = (e) => {
    if (e.target.closest('.event-card-actions')) return
    if (hasMoved) return
    onTap?.(event)
  }

  return (
    <motion.div
      className={`event-swipe-card ${isDragging ? 'dragging' : ''}`}
      style={{ x, y, rotate, ...style }}
      {...(isTop ? bind() : {})}
      onClick={isTop ? handleCardClick : undefined}
    >
      {/* Background Image */}
      <div className="event-card-image-container">
        {!imageLoaded && <div className="event-card-image-placeholder" />}
        <img
          src={imageUrl}
          alt={event.name}
          className={`event-card-image ${imageLoaded ? 'loaded' : ''}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Gradient Overlay */}
      <div className="event-card-gradient" />

      {/* Action Indicators */}
      <motion.div className="event-card-indicator like" style={{ opacity: likeOpacity }}>
        SAVE
      </motion.div>
      <motion.div className="event-card-indicator nope" style={{ opacity: nopeOpacity }}>
        SKIP
      </motion.div>
      <motion.div className="event-card-indicator go" style={{ opacity: goOpacity }}>
        TICKETS
      </motion.div>

      {/* Content */}
      <div className="event-card-content">
        <div className="event-card-badges-row">
          <span className="event-card-source" style={{ '--source-color': sourceInfo.color }}>
            <span>{event.categories?.[0] === 'music' ? '🎵' : '🎭'}</span>
            {sourceInfo.name}
          </span>
          {event.pricing?.isFree && (
            <span className="event-card-badge free">FREE</span>
          )}
        </div>

        <h2 className="event-card-name">{event.name}</h2>

        <div className="event-card-meta">
          <span className="event-card-meta-item">
            <CalendarSmallIcon />
            {formatEventDate(event.datetime?.start)}
          </span>
          {event.venue?.name && (
            <span className="event-card-meta-item">
              <MapPinIcon />
              {event.venue.name}
            </span>
          )}
          {!event.pricing?.isFree && event.pricing?.minPrice && (
            <span className="event-card-meta-item price">
              {formatPriceRange(event.pricing)}
            </span>
          )}
        </div>

        {event.description && (
          <p className="event-card-description">"{event.description}"</p>
        )}

        {event.venue?.address && (
          <p className="event-card-address">{event.venue.address}</p>
        )}
      </div>

      {/* Action Buttons - Matches SwipeCard */}
      {isTop && (
        <div className="event-card-actions">
          <button
            className="event-card-btn nope"
            onClick={() => handleButtonClick('nope')}
            aria-label="Skip this event"
          >
            <XIcon />
          </button>
          <a
            href={event.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="event-card-btn go"
            onClick={(e) => e.stopPropagation()}
            aria-label="Get tickets"
          >
            <TicketIcon />
          </a>
          <button
            className="event-card-btn like"
            onClick={() => handleButtonClick('like')}
            aria-label="Save this event"
          >
            <HeartIcon />
          </button>
        </div>
      )}
    </motion.div>
  )
}
