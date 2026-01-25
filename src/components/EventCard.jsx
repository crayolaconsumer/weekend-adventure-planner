/**
 * Event Card Component
 *
 * Displays event information in compact or full variants.
 */

import { motion } from 'framer-motion'
import { formatEventDate, formatPriceRange } from '../utils/eventsApi'
import './EventCard.css'

// Event category placeholder images (same as Events.jsx)
const EVENT_IMAGES = {
  music: [
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80',
    'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&q=80',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80',
  ],
  entertainment: [
    'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
    'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=800&q=80',
  ],
  culture: [
    'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=800&q=80',
    'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800&q=80',
  ],
  nightlife: [
    'https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800&q=80',
    'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&q=80',
  ],
  default: [
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
    'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&q=80',
  ]
}

function getEventPlaceholderImage(eventId, categories) {
  const category = categories?.[0] || 'default'
  const images = EVENT_IMAGES[category] || EVENT_IMAGES.default
  const index = Math.abs(eventId?.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0) || 0) % images.length
  return images[index]
}

// Icons
const CalendarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const TicketIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
    <path d="M13 5v2"/>
    <path d="M13 17v2"/>
    <path d="M13 11v2"/>
  </svg>
)

const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)

export default function EventCard({ event, variant = 'compact' }) {
  if (!event) return null

  const handleClick = () => {
    if (event.ticketUrl) {
      window.open(event.ticketUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const priceLabel = formatPriceRange(event.pricing)
  const dateLabel = formatEventDate(event.datetime.start)
  const imageUrl = event.imageUrl || getEventPlaceholderImage(event.id, event.categories)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  if (variant === 'compact') {
    return (
      <motion.div
        className="event-card event-card-compact"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        tabIndex={0}
        role="button"
        aria-label={`${event.name} on ${dateLabel}${event.pricing?.isFree ? ', Free' : priceLabel ? `, ${priceLabel}` : ''}. Press Enter to view tickets.`}
      >
        <div className="event-card-image">
          <img src={imageUrl} alt={event.name} loading="lazy" />
        </div>

        <div className="event-card-content">
          <div className="event-card-meta">
            <span className="event-card-date">
              <CalendarIcon />
              {dateLabel}
            </span>
            {event.pricing.isFree && (
              <span className="event-card-free">Free</span>
            )}
          </div>

          <h4 className="event-card-title">{event.name}</h4>

          <span className="event-card-venue">
            <MapPinIcon />
            {event.venue.name}
          </span>
        </div>

        {event.isSoldOut && (
          <div className="event-card-sold-out">Sold Out</div>
        )}
      </motion.div>
    )
  }

  // Full variant
  return (
    <motion.article
      className="event-card event-card-full"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="event-card-image">
        <img src={imageUrl} alt={event.name} loading="lazy" />
        {event.isSoldOut && (
          <div className="event-card-sold-out-badge">Sold Out</div>
        )}
      </div>

      <div className="event-card-body">
        <div className="event-card-header">
          <span className="event-card-date-badge">
            <CalendarIcon />
            {dateLabel}
          </span>
          {event.pricing.isFree ? (
            <span className="event-card-price-free">Free</span>
          ) : (
            <span className="event-card-price">
              <TicketIcon />
              {priceLabel}
            </span>
          )}
        </div>

        <h3 className="event-card-title">{event.name}</h3>

        {event.description && (
          <p className="event-card-description">{event.description}</p>
        )}

        <div className="event-card-venue-info">
          <MapPinIcon />
          <div>
            <span className="event-card-venue-name">{event.venue.name}</span>
            {event.venue.address && (
              <span className="event-card-venue-address">{event.venue.address}</span>
            )}
          </div>
        </div>

        <motion.button
          className="event-card-cta"
          onClick={handleClick}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          disabled={event.isSoldOut}
        >
          {event.isSoldOut ? 'Sold Out' : 'Get Tickets'}
          {!event.isSoldOut && <ExternalLinkIcon />}
        </motion.button>
      </div>
    </motion.article>
  )
}
