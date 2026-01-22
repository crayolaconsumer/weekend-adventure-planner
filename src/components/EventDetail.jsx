/**
 * Event Detail Modal
 *
 * Shows detailed information about an event when tapped from the events feed.
 * Design: Matches PlaceDetail modal for brand consistency
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatEventDate, formatPriceRange, getSourceInfo } from '../utils/eventsApi'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './EventDetail.css'

// Event category placeholder images
const EVENT_IMAGES = {
  music: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80',
  entertainment: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
  culture: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
  nightlife: 'https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800&q=80',
  default: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80'
}

// Icons
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const ClockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12,6 12,12 16,14"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const TicketIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
  </svg>
)

const ExternalLinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const HeartIcon = ({ filled }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
)

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/>
    <circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
)

const UserIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

const MusicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13"/>
    <circle cx="6" cy="18" r="3"/>
    <circle cx="18" cy="16" r="3"/>
  </svg>
)

const PoundIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M8 12h4"/>
    <path d="M10 16V8.5a2.5 2.5 0 0 1 5 0"/>
    <path d="M8 16h8"/>
  </svg>
)

export default function EventDetail({ event, onClose, onSave, isSaved }) {
  const [imageLoaded, setImageLoaded] = useState(false)

  // Handle escape key - must be before any conditional returns
  useEffect(() => {
    if (!event) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [event, onClose])

  // Prevent body scroll when modal is open - must be before any conditional returns
  useEffect(() => {
    if (!event) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [event])

  // Focus trap for accessibility
  const focusTrapRef = useFocusTrap(!!event)

  if (!event) return null

  const sourceInfo = getSourceInfo(event.source)
  const categoryImage = EVENT_IMAGES[event.categories?.[0]] || EVENT_IMAGES.default
  const imageUrl = event.imageUrl || categoryImage

  // Format full date with day of week
  const formatFullDate = (date) => {
    if (!date) return 'Date TBA'
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  // Format time
  const formatTime = (date) => {
    if (!date) return null
    return date.toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  // Handle share
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: event.name,
          text: `Check out ${event.name}`,
          url: event.ticketUrl
        })
      } catch {
        // User cancelled or share failed
      }
    } else {
      navigator.clipboard.writeText(event.ticketUrl)
    }
  }

  // Open in maps
  const openInMaps = () => {
    if (event.venue?.lat && event.venue?.lng) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${event.venue.lat},${event.venue.lng}`
      window.open(url, '_blank')
    } else if (event.venue?.address) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue.address)}`
      window.open(url, '_blank')
    }
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        className="event-detail-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        onClick={onClose}
      >
        <motion.div
          ref={focusTrapRef}
          className="event-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-detail-title"
          initial={{ opacity: 0, y: '100%', scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{
            opacity: 0,
            y: '100%',
            scale: 0.95,
            transition: {
              type: 'spring',
              stiffness: 400,
              damping: 35,
              mass: 0.8
            }
          }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 30,
            mass: 0.8
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Hero Image */}
          <div className="event-detail-hero">
            {!imageLoaded && <div className="event-detail-image-placeholder" />}
            <motion.img
              src={imageUrl}
              alt={event.name}
              className={`event-detail-image ${imageLoaded ? 'loaded' : ''}`}
              onLoad={() => setImageLoaded(true)}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
            <div className="event-detail-hero-gradient" />

            {/* Close button */}
            <button className="event-detail-close" onClick={onClose} aria-label="Close event details">
              <CloseIcon />
            </button>

            {/* Source badge */}
            <motion.span
              className="event-detail-source"
              style={{ '--source-color': sourceInfo.color }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <span>{event.categories?.[0] === 'music' ? '🎵' : '🎭'}</span>
              {sourceInfo.name}
            </motion.span>
          </div>

          {/* Content */}
          <div className="event-detail-content">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <h1 id="event-detail-title" className="event-detail-name">{event.name}</h1>

              {/* Quick info pills */}
              <div className="event-detail-pills">
                <span className="event-detail-pill date">
                  <CalendarIcon />
                  {formatEventDate(event.datetime?.start)}
                </span>
                {event.pricing?.isFree && (
                  <span className="event-detail-pill free">FREE</span>
                )}
                {!event.pricing?.isFree && event.pricing?.minPrice && (
                  <span className="event-detail-pill price">
                    <PoundIcon />
                    {formatPriceRange(event.pricing)}
                  </span>
                )}
                {event.minAge && (
                  <span className="event-detail-pill age">
                    {event.minAge}+
                  </span>
                )}
              </div>

              {/* Genre badge */}
              {event.genre && (
                <span className="event-detail-genre">{event.genre}</span>
              )}
            </motion.div>

            {/* Quick actions */}
            <motion.div
              className="event-detail-actions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <button
                className={`event-detail-action-btn ${isSaved ? 'saved' : ''}`}
                onClick={() => onSave && onSave(event)}
              >
                <HeartIcon filled={isSaved} />
                <span>{isSaved ? 'Saved' : 'Save'}</span>
              </button>
              <button className="event-detail-action-btn" onClick={handleShare}>
                <ShareIcon />
                <span>Share</span>
              </button>
              {(event.venue?.lat || event.venue?.address) && (
                <button className="event-detail-action-btn" onClick={openInMaps}>
                  <NavigationIcon />
                  <span>Directions</span>
                </button>
              )}
            </motion.div>

            {/* Venue Section */}
            {event.venue?.name && (
              <motion.div
                className="event-detail-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <h3 className="event-detail-section-title">
                  <MapPinIcon />
                  Venue
                </h3>
                <p className="event-detail-venue-name">{event.venue.name}</p>
                {event.venue.address && (
                  <p className="event-detail-venue-address">{event.venue.address}</p>
                )}
              </motion.div>
            )}

            {/* Date & Time Section */}
            <motion.div
              className="event-detail-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <h3 className="event-detail-section-title">
                <ClockIcon />
                Date & Time
              </h3>
              <p className="event-detail-datetime">
                {formatFullDate(event.datetime?.start)}
              </p>
              {event.datetime?.start && (
                <p className="event-detail-time">
                  {formatTime(event.datetime.start)}
                  {event.datetime?.doorsOpen && ` · Doors: ${event.datetime.doorsOpen}`}
                </p>
              )}
            </motion.div>

            {/* Description */}
            {event.description && (
              <motion.div
                className="event-detail-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h3 className="event-detail-section-title">About</h3>
                <p className="event-detail-description">{event.description}</p>
              </motion.div>
            )}

            {/* Artists (Skiddle) */}
            {event.artists?.length > 0 && (
              <motion.div
                className="event-detail-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
              >
                <h3 className="event-detail-section-title">
                  <MusicIcon />
                  Artists
                </h3>
                <div className="event-detail-artists">
                  {event.artists.slice(0, 8).map((artist, i) => (
                    <span key={i} className="event-detail-artist">
                      {artist.name || artist}
                    </span>
                  ))}
                  {event.artists.length > 8 && (
                    <span className="event-detail-artist more">
                      +{event.artists.length - 8} more
                    </span>
                  )}
                </div>
              </motion.div>
            )}

            {/* Categories */}
            {event.categories?.length > 0 && (
              <motion.div
                className="event-detail-categories"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                {event.categories.map((cat, i) => (
                  <span key={i} className="event-detail-category">{cat}</span>
                ))}
              </motion.div>
            )}

            {/* Sold out warning */}
            {event.isSoldOut && (
              <motion.div
                className="event-detail-sold-out"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                This event is sold out
              </motion.div>
            )}

            {/* Get Tickets CTA */}
            <motion.a
              href={event.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`event-detail-cta ${event.isSoldOut ? 'sold-out' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <TicketIcon />
              <span>{event.isSoldOut ? 'Check Availability' : 'Get Tickets'}</span>
              <ExternalLinkIcon />
            </motion.a>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
