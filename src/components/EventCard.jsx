/**
 * Event Card Component
 *
 * Displays event information in compact or full variants.
 */

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { formatEventDate, formatPriceRange } from '../utils/eventsApi'
import { trackPromotedEvent } from '../utils/promotedEventsApi'
// Shared with EventDetail so card and detail show the SAME fallback image.
import { getEventPlaceholderImage } from '../pages/Events/placeholderImage'
import './EventCard.css'

// Icons
const CalendarIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const MapPinIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const TicketIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
    <path d="M13 5v2"/>
    <path d="M13 17v2"/>
    <path d="M13 11v2"/>
  </svg>
)

const ExternalLinkIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)

export default function EventCard({ event, variant = 'compact' }) {
  // Count a "Featured" impression once per mount (server dedups per session).
  useEffect(() => {
    if (event?.isFeatured && event?.promotedId) {
      trackPromotedEvent(event.promotedId, 'impression')
    }
  }, [event?.isFeatured, event?.promotedId])

  if (!event) return null

  const handleClick = () => {
    if (event.isFeatured && event.promotedId) {
      trackPromotedEvent(event.promotedId, 'click')
    }
    if (event.ticketUrl) {
      // openExternalUrl uses Capacitor Browser on native (in-app SF
      // Safari View / Custom Tabs UX), window.open on web.
      import('../utils/nativePlugins').then(m => m.openExternalUrl(event.ticketUrl))
    }
  }

  const priceLabel = formatPriceRange(event.pricing)
  const dateLabel = formatEventDate(event.datetime.start)
  const imageUrl = event.imageUrl || getEventPlaceholderImage(event.id, event.categories)

  // Admission model — only first-party (Featured) events carry ticketType.
  // online + door can combine ('online_door'); 'free' is exclusive. Lets a
  // door-sale, free or sold-both-ways event read correctly, not "Get Tickets".
  const ticketType = event.isFeatured ? (event.ticketType || 'online') : null
  const sellsOnline = ticketType === 'online' || ticketType === 'online_door'
  const admissionLabel = ticketType === 'online_door' ? 'Online & door'
    : ticketType === 'door' ? 'Pay on the door'
      : ticketType === 'free' ? 'Free entry'
        : null
  const hasLink = !!event.ticketUrl
  const ctaText = sellsOnline ? 'Get Tickets'
    : ticketType ? 'More info'  // door / free that still has an info link
      : 'Get Tickets'           // aggregator events — same Title Case as Wishlist
  // A Featured card only gets a clickable CTA when there's actually a link;
  // otherwise it shows a static label so it can never read as a dead button.
  const showButton = hasLink || !event.isFeatured
  const staticLabel = admissionLabel || priceLabel || 'Details to follow'
  // A Featured card with nothing to open must NOT pose as a clickable button
  // (dead-end). Aggregator cards keep their existing behaviour.
  const interactive = !event.isFeatured || hasLink

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  if (variant === 'compact') {
    return (
      <motion.div
        className={`event-card event-card-compact${event.isFeatured ? ' is-featured' : ''}`}
        {...(interactive
          ? {
              onClick: handleClick,
              onKeyDown: handleKeyDown,
              tabIndex: 0,
              role: 'button',
              whileHover: { scale: 1.02 },
              whileTap: { scale: 0.98 },
              'aria-label': `${event.name} on ${dateLabel}${admissionLabel ? `, ${admissionLabel}` : event.pricing?.isFree ? ', Free' : priceLabel ? `, ${priceLabel}` : ''}. Press Enter to view details.`
            }
          : { 'aria-label': `${event.name} on ${dateLabel}${admissionLabel ? `, ${admissionLabel}` : ''}` })}
      >
        <div className="event-card-image">
          {event.isFeatured && (
            <div className="event-card-featured" aria-label="Featured event">Featured</div>
          )}
          <img
            src={imageUrl}
            alt={event.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              // Ticketmaster / Skiddle CDN URLs go stale frequently;
              // hide the <img> rather than show a broken-image glyph
              // — the parent .event-card-image already has a
              // brand-coloured background that reads as a placeholder.
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>

        <div className="event-card-content">
          <div className="event-card-meta">
            <span className="event-card-date">
              <CalendarIcon />
              {dateLabel}
            </span>
            {admissionLabel ? (
              <span className="event-card-admission">{admissionLabel}</span>
            ) : event.pricing.isFree && (
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
      className={`event-card event-card-full${event.isFeatured ? ' is-featured' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="event-card-image">
        {event.isFeatured && (
          <div className="event-card-featured" aria-label="Featured event">Featured</div>
        )}
        <img src={imageUrl} alt={event.name} loading="lazy" referrerPolicy="no-referrer" />
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

        {event.isFeatured && event.orgName && (
          <p className="event-card-org">Featured by {event.orgName}</p>
        )}

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

        {event.isSoldOut ? (
          <button className="event-card-cta" disabled>Sold Out</button>
        ) : showButton ? (
          <motion.button
            className="event-card-cta"
            onClick={handleClick}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {ctaText}
            <ExternalLinkIcon />
          </motion.button>
        ) : (
          // Featured event with no link (door / free / link-less) — show a
          // static label, never a button that does nothing.
          <div className="event-card-cta event-card-cta-static">{staticLabel}</div>
        )}
        {!event.isSoldOut && ticketType === 'online_door' && hasLink && (
          <p className="event-card-door-note">or pay on the door</p>
        )}
      </div>
    </motion.article>
  )
}
