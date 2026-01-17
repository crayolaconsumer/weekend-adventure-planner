/**
 * Events Page
 *
 * Tinder-style event discovery with multi-source aggregation.
 * Sources: Ticketmaster, Skiddle, Eventbrite
 *
 * Design: Matches Discover page swipe cards for brand consistency
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
import EventCard from '../components/EventCard'
import EventDetail from '../components/EventDetail'
import {
  fetchAllEvents,
  getTodayEvents,
  getWeekendEvents,
  getFreeEvents,
  formatEventDate,
  formatPriceRange,
  getSourceInfo
} from '../utils/eventsApi'
import './Events.css'

// Filter options
const FILTERS = [
  { id: 'all', label: 'All Events', icon: '📅' },
  { id: 'today', label: 'Today', icon: '🌟' },
  { id: 'weekend', label: 'This Weekend', icon: '🎉' },
  { id: 'free', label: 'Free', icon: '🆓' }
]

// View modes
const VIEW_MODES = {
  SWIPE: 'swipe',
  GRID: 'grid'
}

// Event category placeholder images
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

// Icons - Matching Discover page
const XIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const HeartIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

const TicketIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
  </svg>
)

const CalendarSmallIcon = () => (
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

const CalendarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const RefreshIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2v6h-6"/>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
    <path d="M3 22v-6h6"/>
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
  </svg>
)

const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/>
    <rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/>
  </svg>
)

const StackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <rect x="2" y="6" width="16" height="16" rx="2" opacity="0.5"/>
  </svg>
)

const ExternalLinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)

// Swipeable Event Card Component - Matches SwipeCard design
function SwipeableEventCard({ event, onSwipe, onTap, style, isTop = false }) {
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
    { enabled: isTop }
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

export default function Events({ location }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')
  const [viewMode, setViewMode] = useState(VIEW_MODES.SWIPE)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [savedEvents, setSavedEvents] = useState(() => {
    const saved = localStorage.getItem('roam_saved_events')
    return saved ? JSON.parse(saved) : []
  })
  const [apiStatus, setApiStatus] = useState({ hasEvents: false, sources: [] })

  // Fetch events when location changes
  useEffect(() => {
    loadEvents()
  }, [location?.lat, location?.lng])

  // Save events to localStorage
  useEffect(() => {
    localStorage.setItem('roam_saved_events', JSON.stringify(savedEvents))
  }, [savedEvents])

  const loadEvents = async () => {
    if (!location?.lat || !location?.lng) {
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const fetchedEvents = await fetchAllEvents(location.lat, location.lng, 30)
      setEvents(fetchedEvents)
      setCurrentIndex(0)

      // Track which sources returned data
      const sources = [...new Set(fetchedEvents.map(e => e.source))]
      setApiStatus({
        hasEvents: fetchedEvents.length > 0,
        sources
      })
    } catch (err) {
      console.error('Failed to load events:', err)
      setApiStatus({ hasEvents: false, sources: [] })
    } finally {
      setLoading(false)
    }
  }

  // Filter events based on active filter
  const filteredEvents = (() => {
    switch (activeFilter) {
      case 'today':
        return getTodayEvents(events)
      case 'weekend':
        return getWeekendEvents(events)
      case 'free':
        return getFreeEvents(events)
      default:
        return events
    }
  })()

  // Handle swipe - matches SwipeCard behavior
  const handleSwipe = useCallback((action, event) => {
    if (action === 'like') {
      // Save event
      setSavedEvents(prev => {
        if (prev.find(e => e.id === event.id)) return prev
        return [...prev, { ...event, savedAt: Date.now() }]
      })
    } else if (action === 'go' && event.ticketUrl) {
      // Open tickets in new tab
      window.open(event.ticketUrl, '_blank', 'noopener,noreferrer')
    }
    setCurrentIndex(prev => prev + 1)
  }, [])

  // Toggle save event
  const toggleSaveEvent = useCallback((event) => {
    setSavedEvents(prev => {
      const existing = prev.find(e => e.id === event.id)
      if (existing) {
        return prev.filter(e => e.id !== event.id)
      }
      return [...prev, { ...event, savedAt: Date.now() }]
    })
  }, [])

  // Check if event is saved
  const isEventSaved = useCallback((eventId) => {
    return savedEvents.some(e => e.id === eventId)
  }, [savedEvents])

  // Get visible cards for swipe view
  const visibleCards = filteredEvents.slice(currentIndex, currentIndex + 3)
  const hasMoreEvents = currentIndex < filteredEvents.length

  return (
    <div className="page events-page">
      <header className="page-header events-header">
        <div className="events-title-section">
          <CalendarIcon />
          <div>
            <h1 className="page-title">What's On</h1>
            <p className="events-subtitle">
              {apiStatus.hasEvents
                ? `${filteredEvents.length} events near you`
                : 'Local events near you'
              }
            </p>
          </div>
        </div>
        <div className="events-header-actions">
          <button
            className={`events-view-toggle ${viewMode === VIEW_MODES.SWIPE ? 'active' : ''}`}
            onClick={() => setViewMode(VIEW_MODES.SWIPE)}
            title="Swipe view"
          >
            <StackIcon />
          </button>
          <button
            className={`events-view-toggle ${viewMode === VIEW_MODES.GRID ? 'active' : ''}`}
            onClick={() => setViewMode(VIEW_MODES.GRID)}
            title="Grid view"
          >
            <GridIcon />
          </button>
          {events.length > 0 && (
            <button className="events-refresh-btn" onClick={loadEvents} disabled={loading}>
              <RefreshIcon />
            </button>
          )}
        </div>
      </header>

      {/* Filter tabs */}
      <div className="events-filters">
        {FILTERS.map(filter => (
          <button
            key={filter.id}
            className={`events-filter ${activeFilter === filter.id ? 'active' : ''}`}
            onClick={() => {
              setActiveFilter(filter.id)
              setCurrentIndex(0)
            }}
          >
            <span className="events-filter-icon">{filter.icon}</span>
            {filter.label}
          </button>
        ))}
      </div>

      <div className="page-content">
        {loading ? (
          <div className="events-loading">
            <div className="events-loading-card" />
            <div className="events-loading-card" />
            <div className="events-loading-card" />
          </div>
        ) : !apiStatus.hasEvents ? (
          <div className="events-empty">
            <motion.div
              className="events-empty-icon"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              🎭
            </motion.div>
            <h3>No Events Found</h3>
            <p>
              Add API keys to Vercel Environment Variables to enable event discovery,
              or check out these platforms for events in your area:
            </p>
            <div className="events-api-setup">
              <code>
                TICKETMASTER_KEY<br/>
                SKIDDLE_KEY<br/>
                EVENTBRITE_TOKEN
              </code>
            </div>
            <div className="events-alternatives">
              <a href="https://www.eventbrite.co.uk/d/united-kingdom/events/" target="_blank" rel="noopener noreferrer" className="events-alt-link">
                <span>Eventbrite</span>
                <ExternalLinkIcon />
              </a>
              <a href="https://www.ticketmaster.co.uk/discover/concerts" target="_blank" rel="noopener noreferrer" className="events-alt-link">
                <span>Ticketmaster</span>
                <ExternalLinkIcon />
              </a>
              <a href="https://www.skiddle.com/whats-on/" target="_blank" rel="noopener noreferrer" className="events-alt-link">
                <span>Skiddle</span>
                <ExternalLinkIcon />
              </a>
              <a href="https://www.ents24.com/" target="_blank" rel="noopener noreferrer" className="events-alt-link">
                <span>Ents24</span>
                <ExternalLinkIcon />
              </a>
              <a href="https://www.meetup.com/find/?source=EVENTS" target="_blank" rel="noopener noreferrer" className="events-alt-link">
                <span>Meetup</span>
                <ExternalLinkIcon />
              </a>
              <a href="https://www.facebook.com/events/" target="_blank" rel="noopener noreferrer" className="events-alt-link">
                <span>Facebook Events</span>
                <ExternalLinkIcon />
              </a>
            </div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="events-empty-filter">
            <p>No events match "{FILTERS.find(f => f.id === activeFilter)?.label}"</p>
            <button
              className="events-clear-filter"
              onClick={() => setActiveFilter('all')}
            >
              Show all events
            </button>
          </div>
        ) : viewMode === VIEW_MODES.SWIPE ? (
          <div className="events-swipe-container">
            {!hasMoreEvents ? (
              <div className="events-swipe-empty">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  🎉
                </motion.div>
                <h3>You've seen all events!</h3>
                <p>
                  {savedEvents.length > 0
                    ? `You saved ${savedEvents.length} event${savedEvents.length === 1 ? '' : 's'}`
                    : 'Check back later for more events'
                  }
                </p>
                <button
                  className="events-restart-btn"
                  onClick={() => setCurrentIndex(0)}
                >
                  Start Over
                </button>
              </div>
            ) : (
              <div className="events-swipe-stack">
                <AnimatePresence>
                  {visibleCards.map((event, index) => (
                    <SwipeableEventCard
                      key={event.id}
                      event={event}
                      onSwipe={handleSwipe}
                      onTap={setSelectedEvent}
                      isTop={index === 0}
                      style={{
                        zIndex: visibleCards.length - index,
                        scale: 1 - index * 0.05,
                        y: index * 8,
                        filter: index > 0 ? `brightness(${1 - index * 0.05})` : 'none'
                      }}
                    />
                  ))}
                </AnimatePresence>

                {/* Progress indicator */}
                <div className="events-progress">
                  <div className="events-progress-bar">
                    <div
                      className="events-progress-fill"
                      style={{ width: `${((currentIndex + 1) / filteredEvents.length) * 100}%` }}
                    />
                  </div>
                  <span className="events-progress-text">
                    {currentIndex + 1} of {filteredEvents.length}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="events-grid">
            <AnimatePresence>
              {filteredEvents.map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setSelectedEvent(event)}
                  style={{ cursor: 'pointer' }}
                >
                  <EventCard event={event} variant="full" />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Attribution */}
      {apiStatus.sources.length > 0 && (
        <p className="events-attribution">
          Events from {apiStatus.sources.map(s => getSourceInfo(s).name).join(', ')}
        </p>
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onSave={toggleSaveEvent}
          isSaved={isEventSaved(selectedEvent.id)}
        />
      )}
    </div>
  )
}
