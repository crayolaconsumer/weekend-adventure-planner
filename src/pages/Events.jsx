/**
 * Events Page
 *
 * Tinder-style event discovery with multi-source aggregation.
 * Sources: Ticketmaster, Skiddle, Eventbrite
 *
 * Design: Matches Discover page swipe cards for brand consistency
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
import EventCard from '../components/EventCard'
import EventDetail from '../components/EventDetail'
import {
  fetchAllEvents,
  getTodayEvents,
  getTomorrowEvents,
  getWeekendEvents,
  getThisWeekEvents,
  getThisMonthEvents,
  getFreeEvents,
  formatEventDate,
  formatPriceRange,
  getSourceInfo
} from '../utils/eventsApi'
import {
  getSavedEvents,
  saveEvent,
  unsaveEvent,
  isEventSaved as checkEventSaved,
  getUpcomingSavedEvents
} from '../utils/savedEvents'
import './Events.css'

// Filter options
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'Weekend' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'free', label: 'Free' }
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

const FilterIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
)

const ChevronDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
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

const BookmarkIcon = ({ filled }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
  </svg>
)

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
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

// Radius options in km
const RADIUS_OPTIONS = [5, 10, 25, 50, 100]

// Category options
const CATEGORIES = [
  { id: 'music', label: 'Music' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'theatre', label: 'Theatre' },
  { id: 'sports', label: 'Sports' },
  { id: 'nightlife', label: 'Nightlife' },
  { id: 'food', label: 'Food & Drink' },
  { id: 'family', label: 'Family' },
  { id: 'culture', label: 'Culture' },
  { id: 'entertainment', label: 'Entertainment' }
]

// Price filter options
const PRICE_OPTIONS = [
  { id: 'any', label: 'Any Price', maxPrice: null },
  { id: 'free', label: 'Free', maxPrice: 0 },
  { id: 'under20', label: 'Under £20', maxPrice: 20 },
  { id: 'under50', label: 'Under £50', maxPrice: 50 }
]

export default function Events({ location }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')
  const [viewMode, setViewMode] = useState(VIEW_MODES.SWIPE)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [savedCount, setSavedCount] = useState(() => getSavedEvents().length)
  const [apiStatus, setApiStatus] = useState({ hasEvents: false, sources: [] })
  const [searchRadius, setSearchRadius] = useState(() => {
    const saved = localStorage.getItem('roam_events_radius')
    return saved ? parseInt(saved, 10) : 25
  })
  const [selectedCategories, setSelectedCategories] = useState([])
  const [priceFilter, setPriceFilter] = useState('any')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Count active filters (excluding "all" time filter and "any" price)
  const activeFilterCount = (
    (searchRadius !== 25 ? 1 : 0) +
    selectedCategories.length +
    (priceFilter !== 'any' ? 1 : 0)
  )

  // Fetch events when location or radius changes
  useEffect(() => {
    loadEvents()
  }, [location?.lat, location?.lng, searchRadius])

  // Persist radius to localStorage
  useEffect(() => {
    localStorage.setItem('roam_events_radius', searchRadius.toString())
  }, [searchRadius])


  const loadEvents = async () => {
    if (!location?.lat || !location?.lng) {
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const fetchedEvents = await fetchAllEvents(location.lat, location.lng, searchRadius)
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

  // Toggle category selection
  const toggleCategory = useCallback((categoryId) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(c => c !== categoryId)
      }
      return [...prev, categoryId]
    })
    setCurrentIndex(0)
  }, [])

  // Filter events based on active filter and categories
  const filteredEvents = (() => {
    let result = events

    // Apply time filter
    switch (activeFilter) {
      case 'today':
        result = getTodayEvents(result)
        break
      case 'tomorrow':
        result = getTomorrowEvents(result)
        break
      case 'weekend':
        result = getWeekendEvents(result)
        break
      case 'week':
        result = getThisWeekEvents(result)
        break
      case 'month':
        result = getThisMonthEvents(result)
        break
      case 'free':
        result = getFreeEvents(result)
        break
    }

    // Apply category filter (show events matching ANY selected category)
    if (selectedCategories.length > 0) {
      result = result.filter(event =>
        event.categories?.some(cat =>
          selectedCategories.includes(cat.toLowerCase())
        )
      )
    }

    // Apply price filter
    if (priceFilter !== 'any') {
      const priceOption = PRICE_OPTIONS.find(p => p.id === priceFilter)
      if (priceOption) {
        if (priceFilter === 'free') {
          result = result.filter(event => event.pricing?.isFree)
        } else if (priceOption.maxPrice) {
          result = result.filter(event =>
            event.pricing?.isFree ||
            (event.pricing?.minPrice !== null && event.pricing.minPrice <= priceOption.maxPrice)
          )
        }
      }
    }

    return result
  })()

  // Handle swipe - matches SwipeCard behavior
  const handleSwipe = useCallback((action, event) => {
    if (action === 'like') {
      // Save event using utility
      saveEvent(event)
      setSavedCount(getSavedEvents().length)
    } else if (action === 'go' && event.ticketUrl) {
      // Open tickets in new tab
      window.open(event.ticketUrl, '_blank', 'noopener,noreferrer')
    }
    setCurrentIndex(prev => prev + 1)
  }, [])

  // Toggle save event
  const toggleSaveEvent = useCallback((event) => {
    if (checkEventSaved(event.id)) {
      unsaveEvent(event.id)
    } else {
      saveEvent(event)
    }
    setSavedCount(getSavedEvents().length)
  }, [])

  // Check if event is saved
  const isEventSaved = useCallback((eventId) => {
    return checkEventSaved(eventId)
  }, [])

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
          {/* Filters toggle button */}
          <button
            className={`events-filters-toggle ${filtersOpen ? 'active' : ''} ${activeFilterCount > 0 ? 'has-filters' : ''}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <FilterIcon />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="events-filters-badge">{activeFilterCount}</span>
            )}
            <motion.span
              className="events-filters-chevron"
              animate={{ rotate: filtersOpen ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <ChevronDownIcon />
            </motion.span>
          </button>

          {/* Link to saved events in Wishlist */}
          <Link to="/wishlist" className="events-saved-link" title="View saved events">
            <BookmarkIcon filled={false} />
            {savedCount > 0 && (
              <span className="events-saved-badge">{savedCount}</span>
            )}
          </Link>

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

      {/* Quick time filter chips - Always visible */}
      <div className="events-time-filters">
        {FILTERS.map(filter => (
          <button
            key={filter.id}
            className={`events-time-chip ${activeFilter === filter.id ? 'active' : ''}`}
            onClick={() => {
              setActiveFilter(filter.id)
              setCurrentIndex(0)
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Collapsible Filter Panel */}
      <AnimatePresence>
        {filtersOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="events-filter-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setFiltersOpen(false)}
            />

            {/* Panel */}
            <motion.div
              className="events-filter-panel"
              initial={{ opacity: 0, y: -20, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -20, height: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="events-filter-panel-inner">
                {/* Radius Section */}
                <motion.div
                  className="events-filter-section"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 }}
                >
                  <div className="events-filter-section-header">
                    <span className="events-filter-section-title">Search Radius</span>
                    <span className="events-filter-section-value">{searchRadius}km</span>
                  </div>
                  <div className="events-filter-section-content">
                    <div className="events-radius-track">
                      {RADIUS_OPTIONS.map((radius, idx) => (
                        <button
                          key={radius}
                          className={`events-radius-option ${searchRadius === radius ? 'active' : ''} ${searchRadius > radius ? 'passed' : ''}`}
                          onClick={() => {
                            setSearchRadius(radius)
                            setCurrentIndex(0)
                          }}
                        >
                          <span className="events-radius-dot" />
                          <span className="events-radius-label">{radius}km</span>
                        </button>
                      ))}
                      <div
                        className="events-radius-progress"
                        style={{ width: `${(RADIUS_OPTIONS.indexOf(searchRadius) / (RADIUS_OPTIONS.length - 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </motion.div>

                {/* Categories Section */}
                <motion.div
                  className="events-filter-section"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <div className="events-filter-section-header">
                    <span className="events-filter-section-title">Categories</span>
                    {selectedCategories.length > 0 && (
                      <button
                        className="events-filter-clear"
                        onClick={() => {
                          setSelectedCategories([])
                          setCurrentIndex(0)
                        }}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="events-filter-section-content">
                    <div className="events-category-grid">
                      {CATEGORIES.map((category, idx) => (
                        <motion.button
                          key={category.id}
                          className={`events-category-option ${selectedCategories.includes(category.id) ? 'active' : ''}`}
                          onClick={() => toggleCategory(category.id)}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.1 + idx * 0.02 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          {category.label}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </motion.div>

                {/* Price Section */}
                <motion.div
                  className="events-filter-section"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <div className="events-filter-section-header">
                    <span className="events-filter-section-title">Price Range</span>
                  </div>
                  <div className="events-filter-section-content">
                    <div className="events-price-grid">
                      {PRICE_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          className={`events-price-option ${priceFilter === option.id ? 'active' : ''}`}
                          onClick={() => {
                            setPriceFilter(option.id)
                            setCurrentIndex(0)
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>

                {/* Apply/Close Actions */}
                <motion.div
                  className="events-filter-actions"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  {activeFilterCount > 0 && (
                    <button
                      className="events-filter-reset"
                      onClick={() => {
                        setSearchRadius(25)
                        setSelectedCategories([])
                        setPriceFilter('any')
                        setCurrentIndex(0)
                      }}
                    >
                      Reset all
                    </button>
                  )}
                  <button
                    className="events-filter-apply"
                    onClick={() => setFiltersOpen(false)}
                  >
                    Show {filteredEvents.length} events
                  </button>
                </motion.div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
                  {savedCount > 0
                    ? `You saved ${savedCount} event${savedCount === 1 ? '' : 's'}`
                    : 'Check back later for more events'
                  }
                </p>
                <div className="events-swipe-empty-actions">
                  <button
                    className="events-restart-btn"
                    onClick={() => setCurrentIndex(0)}
                  >
                    Start Over
                  </button>
                  {savedCount > 0 && (
                    <Link to="/wishlist" className="events-view-saved-btn">
                      <BookmarkIcon filled /> View Saved
                    </Link>
                  )}
                </div>
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
