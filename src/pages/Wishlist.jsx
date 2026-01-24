import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import EventCard from '../components/EventCard'
import CollectionManager from '../components/CollectionManager'
import { getSavedEvents, unsaveEvent } from '../utils/savedEvents'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { useSubscription } from '../hooks/useSubscription'
import { openDirections } from '../utils/navigation'
import './Wishlist.css'

// Icons
const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
  </svg>
)

const FolderPlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
    <line x1="12" y1="10" x2="12" y2="16"/>
    <line x1="9" y1="13" x2="15" y2="13"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const NavigationIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="3,11 22,2 13,21 11,13"/>
  </svg>
)

const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3,6 5,6 21,6"/>
    <path d="M19,6V20a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
  </svg>
)

const HeartIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const TicketIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
  </svg>
)

const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)

// Placeholder images
const IMAGES = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&q=80',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80',
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400&q=80',
]

function getPlaceholderImage(id) {
  const index = Math.abs(id?.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0) || 0) % IMAGES.length
  return IMAGES[index]
}

// Tab options
const TABS = {
  PLACES: 'places',
  EVENTS: 'events'
}

// Pagination constants
const PAGE_SIZE = 12

export default function Wishlist() {
  const navigate = useNavigate()
  const { places: wishlist, removePlace, loading: placesLoading } = useSavedPlaces()
  const [savedEvents, setSavedEvents] = useState(() => getSavedEvents())
  const [eventsError, setEventsError] = useState(null)
  const [activeTab, setActiveTab] = useState(TABS.PLACES)
  const [filter, setFilter] = useState('all')
  const { isPremium } = useSubscription()

  // Pagination state
  const [placesDisplayLimit, setPlacesDisplayLimit] = useState(PAGE_SIZE)
  const [eventsDisplayLimit, setEventsDisplayLimit] = useState(PAGE_SIZE)

  // Collection manager state
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [showCollectionManager, setShowCollectionManager] = useState(false)

  const openCollectionManager = (place) => {
    setSelectedPlace(place)
    setShowCollectionManager(true)
  }

  const removeFromWishlist = (placeId) => {
    removePlace(placeId)
  }

  const removeEvent = (eventId) => {
    try {
      unsaveEvent(eventId)
      setSavedEvents(getSavedEvents())
      setEventsError(null)
    } catch (error) {
      console.error('Failed to remove event:', error)
      setEventsError('Failed to remove event. Please try again.')
    }
  }

  const goToPlace = (place) => {
    openDirections(place.lat, place.lng, place.name)
  }

  const formatSavedDate = (timestamp) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  // Get unique categories from wishlist
  const categories = [...new Set(wishlist.map(p => p.category?.key).filter(Boolean))]

  // Filter wishlist
  const filteredWishlist = filter === 'all'
    ? wishlist
    : wishlist.filter(p => p.category?.key === filter)

  // Paginated items
  const displayedPlaces = filteredWishlist.slice(0, placesDisplayLimit)
  const displayedEvents = savedEvents.slice(0, eventsDisplayLimit)
  const hasMorePlaces = filteredWishlist.length > placesDisplayLimit
  const hasMoreEvents = savedEvents.length > eventsDisplayLimit

  // Total saved count
  const totalSaved = wishlist.length + savedEvents.length

  return (
    <div className="page wishlist-page">
      <header className="page-header wishlist-header">
        <div>
          <h1 className="page-title">Saved</h1>
          <div className="wishlist-subtitle-row">
            <p className="wishlist-subtitle">
              {totalSaved} {totalSaved === 1 ? 'item' : 'items'} saved
            </p>
            {!isPremium && (
              <Link
                to="/pricing"
                className={`wishlist-limit ${wishlist.length >= 8 ? 'warning' : ''} ${wishlist.length >= 10 ? 'full' : ''}`}
              >
                {wishlist.length}/10
                {wishlist.length >= 8 && <span className="limit-upgrade-hint">Upgrade</span>}
              </Link>
            )}
          </div>
        </div>
        <Link to="/collections" className="wishlist-collections-link">
          <FolderIcon />
          Collections
        </Link>
      </header>

      {/* Tabs */}
      <div className="wishlist-tabs">
        <button
          className={`wishlist-tab ${activeTab === TABS.PLACES ? 'active' : ''}`}
          onClick={() => {
            setActiveTab(TABS.PLACES)
            setFilter('all')
            setPlacesDisplayLimit(PAGE_SIZE)
          }}
        >
          <MapPinIcon />
          Places
          {wishlist.length > 0 && <span className="wishlist-tab-count">{wishlist.length}</span>}
        </button>
        <button
          className={`wishlist-tab ${activeTab === TABS.EVENTS ? 'active' : ''}`}
          onClick={() => {
            setActiveTab(TABS.EVENTS)
            setFilter('all')
            setEventsDisplayLimit(PAGE_SIZE)
          }}
        >
          <CalendarIcon />
          Events
          {savedEvents.length > 0 && <span className="wishlist-tab-count">{savedEvents.length}</span>}
        </button>
      </div>

      <div className="page-content">
        {/* PLACES TAB */}
        {activeTab === TABS.PLACES && (
          placesLoading ? (
            <div className="wishlist-loading">
              <div className="wishlist-loading-spinner" />
              <p>Loading saved places...</p>
            </div>
          ) : wishlist.length > 0 ? (
            <>
              {/* Category Filters */}
              {categories.length > 1 && (
                <div className="wishlist-filters">
                  <button
                    className={`chip ${filter === 'all' ? 'selected' : ''}`}
                    onClick={() => {
                      setFilter('all')
                      setPlacesDisplayLimit(PAGE_SIZE)
                    }}
                  >
                    All
                  </button>
                  {categories.map(cat => {
                    const category = wishlist.find(p => p.category?.key === cat)?.category
                    return (
                      <button
                        key={cat}
                        className={`chip ${filter === cat ? 'selected' : ''}`}
                        onClick={() => {
                          setFilter(cat)
                          setPlacesDisplayLimit(PAGE_SIZE)
                        }}
                      >
                        {category?.icon} {category?.label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Places Grid */}
              <div className="wishlist-grid">
                <AnimatePresence>
                  {displayedPlaces.map((place, index) => (
                    <motion.div
                      key={place.id}
                      className="wishlist-card"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ delay: Math.min(index, 11) * 0.05 }}
                    >
                      <div
                        className="wishlist-card-image"
                        style={{
                          backgroundImage: `url(${place.photo || place.image || getPlaceholderImage(place.id)})`
                        }}
                      >
                        <div className="wishlist-card-gradient" />
                        {place.category && (
                          <span className="wishlist-card-category">
                            {place.category.icon}
                          </span>
                        )}
                      </div>

                      <div className="wishlist-card-content">
                        <h3 className="wishlist-card-name">{place.name}</h3>

                        <div className="wishlist-card-meta">
                          {place.type && (
                            <span className="wishlist-card-type">
                              {place.type.replace(/_/g, ' ')}
                            </span>
                          )}
                          {place.distance && (
                            <span className="wishlist-card-distance">
                              <MapPinIcon />
                              {place.distance < 1
                                ? `${Math.round(place.distance * 1000)}m`
                                : `${place.distance.toFixed(1)}km`
                              }
                            </span>
                          )}
                        </div>

                        <span className="wishlist-card-saved">
                          Saved {formatSavedDate(place.savedAt)}
                        </span>

                        <div className="wishlist-card-actions">
                          <button
                            className="wishlist-card-btn go"
                            onClick={() => goToPlace(place)}
                          >
                            <NavigationIcon />
                            Go
                          </button>
                          <button
                            className="wishlist-card-btn collection"
                            onClick={() => openCollectionManager(place)}
                            aria-label={`Add ${place.name} to collection`}
                          >
                            <FolderPlusIcon />
                          </button>
                          <button
                            className="wishlist-card-btn remove"
                            onClick={() => removeFromWishlist(place.id)}
                            aria-label={`Remove ${place.name} from wishlist`}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Load More Button */}
              {hasMorePlaces && (
                <button
                  className="wishlist-load-more"
                  onClick={() => setPlacesDisplayLimit(prev => prev + PAGE_SIZE)}
                >
                  Load More ({filteredWishlist.length - placesDisplayLimit} remaining)
                </button>
              )}
            </>
          ) : (
            <div className="wishlist-empty">
              <div className="wishlist-empty-icon">
                <HeartIcon />
              </div>
              <h3>No saved places yet</h3>
              <p>Swipe right on places you want to visit later, and they'll appear here.</p>
              <button
                className="wishlist-empty-cta"
                onClick={() => navigate('/')}
              >
                Discover Places
              </button>
            </div>
          )
        )}

        {/* EVENTS TAB */}
        {activeTab === TABS.EVENTS && (
          eventsError ? (
            <div className="wishlist-error">
              <p>{eventsError}</p>
              <button onClick={() => {
                setEventsError(null)
                setSavedEvents(getSavedEvents())
                setEventsDisplayLimit(PAGE_SIZE)
              }}>
                Retry
              </button>
            </div>
          ) : savedEvents.length > 0 ? (
            <>
              <div className="wishlist-events-grid">
                <AnimatePresence>
                  {displayedEvents.map((event, index) => (
                    <motion.div
                      key={event.id}
                      className="wishlist-event-card"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, x: -100 }}
                      transition={{ delay: Math.min(index, 11) * 0.05 }}
                      layout
                    >
                      <div className="wishlist-event-content">
                        <EventCard event={event} variant="full" />
                      </div>
                      <div className="wishlist-event-actions">
                        {event.ticketUrl && (
                          <a
                            href={event.ticketUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="wishlist-event-btn tickets"
                          >
                            <TicketIcon />
                            Get Tickets
                          </a>
                        )}
                        <button
                          className="wishlist-event-btn remove"
                          onClick={() => removeEvent(event.id)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Load More Button */}
              {hasMoreEvents && (
                <button
                  className="wishlist-load-more"
                  onClick={() => setEventsDisplayLimit(prev => prev + PAGE_SIZE)}
                >
                  Load More ({savedEvents.length - eventsDisplayLimit} remaining)
                </button>
              )}
            </>
          ) : (
            <div className="wishlist-empty">
              <div className="wishlist-empty-icon events">
                <CalendarIcon />
              </div>
              <h3>No saved events yet</h3>
              <p>Swipe right on events you're interested in to save them here.</p>
              <button
                className="wishlist-empty-cta"
                onClick={() => navigate('/events')}
              >
                Discover Events
              </button>
            </div>
          )
        )}
      </div>

      {/* Collection Manager Modal */}
      {selectedPlace && (
        <CollectionManager
          isOpen={showCollectionManager}
          onClose={() => {
            setShowCollectionManager(false)
            setSelectedPlace(null)
          }}
          place={selectedPlace}
        />
      )}
    </div>
  )
}
