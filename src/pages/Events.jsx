/**
 * Events Page
 *
 * Tinder-style event discovery with multi-source aggregation.
 * Sources: Ticketmaster, Skiddle
 *
 * Design: Matches Discover page swipe cards for brand consistency
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import EventCard from '../components/EventCard'
import EmptyStateIllustration from '../components/icons/EmptyStateIllustration'
import EventDetail from '../components/EventDetail'
import {
  fetchAllEvents,
  fetchMoreEvents,
  getTodayEvents,
  getTomorrowEvents,
  getWeekendEvents,
  getThisWeekEvents,
  getThisMonthEvents,
  getFreeEvents,
  sortEvents,
  getSourceInfo,
} from '../utils/eventsApi'
import { useSavedEvents } from '../hooks/useSavedEvents'
import {
  FILTERS, VIEW_MODES, RADIUS_OPTIONS, CATEGORIES,
  PRICE_OPTIONS, SORT_OPTIONS, EVENTS_PAGE_SIZE, EVENTS_LOAD_MORE_THRESHOLD,
} from './Events/constants'
import {
  FilterIcon, ChevronDownIcon, CalendarIcon, RefreshIcon,
  GridIcon, StackIcon, BookmarkIcon, ExternalLinkIcon,
} from './Events/icons'
import SwipeableEventCard from './Events/SwipeableEventCard'
import './Events.css'

export default function Events({ location }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [displayLimit, setDisplayLimit] = useState(EVENTS_PAGE_SIZE)
  const [activeFilter, setActiveFilter] = useState('all')
  // Default to GRID (list-like). Swipe mode is opt-in via the toggle —
  // most users want to scan a list of upcoming events, not flick through
  // them card-by-card the way they would on the Discover tab.
  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const { events: savedEventsList, saveEvent, unsaveEvent, isEventSaved: checkEventSaved } = useSavedEvents()
  const savedCount = savedEventsList.length
  const [apiStatus, setApiStatus] = useState({ hasEvents: false, sources: [] })
  // Server-side pagination state
  const [hasMoreFromServer, setHasMoreFromServer] = useState(false)
  const [nextServerPage, setNextServerPage] = useState(0)
  const [totalAvailable, setTotalAvailable] = useState(0)
  const loadMoreTimeoutRef = useRef(null)
  const [searchRadius, setSearchRadius] = useState(() => {
    const saved = localStorage.getItem('roam_events_radius')
    return saved ? parseInt(saved, 10) : 25
  })
  const [selectedCategories, setSelectedCategories] = useState([])
  const [priceFilter, setPriceFilter] = useState('any')
  const [sortBy, setSortBy] = useState(() => {
    return localStorage.getItem('roam_events_sort') || 'recommended'
  })
  const [hideSoldOut, setHideSoldOut] = useState(() => {
    return localStorage.getItem('roam_events_hide_sold_out') === 'true'
  })
  const [hideSeen, setHideSeen] = useState(() => {
    const saved = localStorage.getItem('roam_events_hide_seen')
    return saved ? saved === 'true' : true
  })
  const [seenEventIds, setSeenEventIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('roam_events_seen') || '[]')
      return new Set(saved)
    } catch {
      return new Set()
    }
  })
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Count active filters (excluding "all" time filter and "any" price)
  const activeFilterCount = (
    (searchRadius !== 25 ? 1 : 0) +
    selectedCategories.length +
    (priceFilter !== 'any' ? 1 : 0) +
    (sortBy !== 'recommended' ? 1 : 0) +
    (hideSoldOut ? 1 : 0) +
    (!hideSeen ? 1 : 0)
  )

  const loadEvents = async () => {
    if (!location?.lat || !location?.lng) {
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const result = await fetchAllEvents(location.lat, location.lng, searchRadius)
      const fetchedEvents = result.events || result // Handle both new and old format
      setEvents(fetchedEvents)
      setCurrentIndex(0)
      setDisplayLimit(EVENTS_PAGE_SIZE)

      // Update server-side pagination state
      setHasMoreFromServer(result.hasMore || false)
      setNextServerPage(result.currentPage || 3) // Default to page 3 since we fetched 0,1,2
      setTotalAvailable(result.totalAvailable || fetchedEvents.length)

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

  // Load more events - either from local cache or fetch from server
  const loadMoreEvents = useCallback(async () => {
    if (loadingMore) return

    setLoadingMore(true)

    // Check if we need to fetch more from server
    const remainingCached = events.length - displayLimit
    if (remainingCached <= 0 && hasMoreFromServer && location?.lat && location?.lng) {
      // Fetch more from server
      try {
        const result = await fetchMoreEvents(
          location.lat,
          location.lng,
          searchRadius,
          nextServerPage,
          3 // Fetch 3 more pages
        )

        if (result.events && result.events.length > 0) {
          // Append new events, avoiding duplicates
          setEvents(prev => {
            const existingIds = new Set(prev.map(e => e.id))
            const newEvents = result.events.filter(e => !existingIds.has(e.id))
            return [...prev, ...newEvents]
          })
          setHasMoreFromServer(result.hasMore)
          setNextServerPage(result.currentPage)
          setTotalAvailable(result.totalAvailable)
        }
      } catch (err) {
        console.error('Failed to load more events:', err)
      }
    }

    // Always increase display limit
    setDisplayLimit(prev => prev + EVENTS_PAGE_SIZE)
    setLoadingMore(false)
  }, [loadingMore, events.length, displayLimit, hasMoreFromServer, location?.lat, location?.lng, searchRadius, nextServerPage])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (loadMoreTimeoutRef.current) {
        clearTimeout(loadMoreTimeoutRef.current)
      }
    }
  }, [])

  // Fetch events when location or radius changes
  useEffect(() => {
    loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadEvents causes infinite loop if added
  }, [location?.lat, location?.lng, searchRadius])

  // Persist radius to localStorage
  useEffect(() => {
    localStorage.setItem('roam_events_radius', searchRadius.toString())
  }, [searchRadius])

  useEffect(() => {
    localStorage.setItem('roam_events_sort', sortBy)
  }, [sortBy])

  useEffect(() => {
    localStorage.setItem('roam_events_hide_sold_out', hideSoldOut.toString())
  }, [hideSoldOut])

  useEffect(() => {
    localStorage.setItem('roam_events_hide_seen', hideSeen.toString())
  }, [hideSeen])

  const markEventSeen = useCallback((eventId) => {
    if (!eventId) return
    setSeenEventIds(prev => {
      const next = new Set(prev)
      next.add(eventId)
      localStorage.setItem('roam_events_seen', JSON.stringify([...next]))
      return next
    })
  }, [])

  const resetSeenEvents = useCallback(() => {
    setSeenEventIds(new Set())
    localStorage.setItem('roam_events_seen', '[]')
  }, [])

  // Toggle category selection
  const toggleCategory = useCallback((categoryId) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(c => c !== categoryId)
      }
      return [...prev, categoryId]
    })
    setCurrentIndex(0)
    setDisplayLimit(EVENTS_PAGE_SIZE)
  }, [])

  // Filter events based on active filter and categories
  // Returns { all: allFiltered, displayed: limitedForDisplay, hasMore: boolean }
  const { allFilteredEvents, filteredEvents, hasMoreToLoad } = (() => {
    let result = events

    // Deduplicate by event ID (safety check - main dedup happens in API)
    const seenIds = new Set()
    result = result.filter(event => {
      if (seenIds.has(event.id)) {
        return false
      }
      seenIds.add(event.id)
      return true
    })

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

    if (hideSoldOut) {
      result = result.filter(event => !event.isSoldOut)
    }

    if (hideSeen && seenEventIds.size > 0) {
      result = result.filter(event => !seenEventIds.has(event.id))
    }

    const sorted = sortEvents(result, sortBy)
    return {
      allFilteredEvents: sorted,
      filteredEvents: sorted.slice(0, displayLimit),
      hasMoreToLoad: sorted.length > displayLimit
    }
  })()

  // Trigger load more when running low on cards in swipe mode
  useEffect(() => {
    if (viewMode !== VIEW_MODES.SWIPE || loading || loadingMore) return

    const remainingCards = filteredEvents.length - currentIndex
    if (remainingCards <= EVENTS_LOAD_MORE_THRESHOLD && hasMoreToLoad) {
      loadMoreEvents()
    }
  }, [currentIndex, filteredEvents.length, hasMoreToLoad, loadMoreEvents, loading, loadingMore, viewMode])

  // Handle swipe - matches SwipeCard behavior
  const handleSwipe = useCallback((action, event) => {
    if (action === 'like') {
      // Save event using hook
      saveEvent(event)
    } else if (action === 'go' && event.ticketUrl) {
      // Open tickets — Capacitor Browser on native, new tab on web
      import('../utils/nativePlugins').then(m => m.openExternalUrl(event.ticketUrl))
    }
    markEventSeen(event?.id)
    if (!hideSeen) {
      setCurrentIndex(prev => prev + 1)
    }
  }, [markEventSeen, hideSeen, saveEvent])

  // Toggle save event
  const toggleSaveEvent = useCallback((event) => {
    if (checkEventSaved(event.id)) {
      unsaveEvent(event.id)
    } else {
      saveEvent(event)
    }
  }, [checkEventSaved, unsaveEvent, saveEvent])

  // Check if event is saved
  const isEventSaved = useCallback((eventId) => {
    return checkEventSaved(eventId)
  }, [checkEventSaved])

  // Get visible cards for swipe view
  const visibleCards = filteredEvents.slice(currentIndex, currentIndex + 3)
  const hasMoreEvents = currentIndex < filteredEvents.length

  return (
    <div className="page events-page">
      <header className="page-header events-header">
        {/* Row 1: Title + Filters */}
        <div className="events-header-primary">
          <div className="events-title-section">
            <CalendarIcon />
            <div>
              <h1 className="page-title">What's On</h1>
              <p className="events-subtitle">
                {apiStatus.hasEvents
                  ? `${filteredEvents.length} events${totalAvailable > events.length ? ` (${totalAvailable.toLocaleString()} available)` : ' near you'}`
                  : 'Local events near you'
                }
              </p>
            </div>
          </div>
          <button
            className={`events-filters-toggle ${filtersOpen ? 'active' : ''} ${activeFilterCount > 0 ? 'has-filters' : ''}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <FilterIcon />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <motion.span
                className="events-filters-badge"
                key={activeFilterCount}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {activeFilterCount}
              </motion.span>
            )}
            <motion.span
              className="events-filters-chevron"
              animate={{ rotate: filtersOpen ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <ChevronDownIcon />
            </motion.span>
          </button>
        </div>

        {/* Row 2: Toolbar - View toggle + secondary actions */}
        <div className="events-header-toolbar">
          <div className="events-view-segmented" role="group" aria-label="View mode">
            <motion.div
              className="events-view-indicator"
              /* Explicit initial position so on first render the pill
                 sits under the currently-active segment instead of
                 defaulting to Cards. initial={false} alone wasn't enough
                 — framer was rendering the pill at x=0 (Cards) on first
                 paint even though viewMode started as GRID. */
              initial={{ x: viewMode === VIEW_MODES.SWIPE ? 0 : '100%' }}
              animate={{ x: viewMode === VIEW_MODES.SWIPE ? 0 : '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
            <button
              className={`events-view-segment ${viewMode === VIEW_MODES.SWIPE ? 'active' : ''}`}
              onClick={() => setViewMode(VIEW_MODES.SWIPE)}
              aria-pressed={viewMode === VIEW_MODES.SWIPE}
            >
              <StackIcon />
              <span>Cards</span>
            </button>
            <button
              className={`events-view-segment ${viewMode === VIEW_MODES.GRID ? 'active' : ''}`}
              onClick={() => setViewMode(VIEW_MODES.GRID)}
              aria-pressed={viewMode === VIEW_MODES.GRID}
            >
              <GridIcon />
              <span>Grid</span>
            </button>
          </div>

          <div className="events-toolbar-actions">
            <Link to="/wishlist" className="events-toolbar-btn" title="View saved events">
              <BookmarkIcon filled={false} />
              {savedCount > 0 && (
                <span className="events-saved-badge">{savedCount}</span>
              )}
            </Link>
            {events.length > 0 && (
              <motion.button
                className="events-toolbar-btn"
                onClick={loadEvents}
                disabled={loading}
                aria-label="Refresh events"
                animate={loading ? { rotate: 360 } : { rotate: 0 }}
                transition={loading ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
              >
                <RefreshIcon />
              </motion.button>
            )}
          </div>
        </div>
      </header>

      {/* Quick time filter chips - Always visible */}
      <div className="events-time-filters" role="group" aria-label="Filter events by time">
        {FILTERS.map(filter => (
          <button
            key={filter.id}
            className={`events-time-chip ${activeFilter === filter.id ? 'active' : ''}`}
            onClick={() => {
              setActiveFilter(filter.id)
              setCurrentIndex(0)
              setDisplayLimit(EVENTS_PAGE_SIZE)
            }}
            aria-pressed={activeFilter === filter.id}
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

            {/* Panel — bottom sheet, mirrors FilterModal (Discover) so all
                filter surfaces in the app share the same vocabulary: slides
                up from the bottom, edge-to-edge on phones, centred max-500
                on tablets. Top-anchored drawer was the odd one out. */}
            <motion.div
              className="events-filter-panel"
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 38 }}
            >
              {/* Drag handle visual — matches FilterModal */}
              <div className="events-filter-panel-handle" aria-hidden="true" />
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
                      {RADIUS_OPTIONS.map((radius) => (
                        <button
                          key={radius}
                          className={`events-radius-option ${searchRadius === radius ? 'active' : ''} ${searchRadius > radius ? 'passed' : ''}`}
                          onClick={() => {
                            setSearchRadius(radius)
                            setCurrentIndex(0)
                            setDisplayLimit(EVENTS_PAGE_SIZE)
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
                          setDisplayLimit(EVENTS_PAGE_SIZE)
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
                            setDisplayLimit(EVENTS_PAGE_SIZE)
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>

                {/* Sort Section */}
                <motion.div
                  className="events-filter-section"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.18 }}
                >
                  <div className="events-filter-section-header">
                    <span className="events-filter-section-title">Sort By</span>
                  </div>
                  <div className="events-filter-section-content">
                    <div className="events-sort-grid">
                      {SORT_OPTIONS.map(option => (
                        <button
                        key={option.id}
                        className={`events-sort-option ${sortBy === option.id ? 'active' : ''}`}
                        onClick={() => {
                          setSortBy(option.id)
                          setCurrentIndex(0)
                          setDisplayLimit(EVENTS_PAGE_SIZE)
                        }}
                      >
                        {option.label}
                      </button>
                      ))}
                    </div>
                  </div>
                </motion.div>

                {/* Visibility Section */}
                <motion.div
                  className="events-filter-section"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="events-filter-section-header">
                    <span className="events-filter-section-title">Visibility</span>
                  </div>
                  <div className="events-filter-section-content">
                    <div className="events-toggle-grid">
                      <button
                        className={`events-toggle-option ${hideSoldOut ? 'active' : ''}`}
                        onClick={() => {
                          setHideSoldOut(prev => !prev)
                          setCurrentIndex(0)
                          setDisplayLimit(EVENTS_PAGE_SIZE)
                        }}
                      >
                        Hide sold out
                      </button>
                      <button
                        className={`events-toggle-option ${hideSeen ? 'active' : ''}`}
                        onClick={() => {
                          setHideSeen(prev => !prev)
                          setCurrentIndex(0)
                          setDisplayLimit(EVENTS_PAGE_SIZE)
                        }}
                      >
                        Hide seen
                      </button>
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
                  {(activeFilterCount > 0 || seenEventIds.size > 0) && (
                    <button
                      className="events-filter-reset"
                      onClick={() => {
                        setSearchRadius(25)
                        setSelectedCategories([])
                        setPriceFilter('any')
                        setSortBy('recommended')
                        setHideSoldOut(false)
                        setHideSeen(true)
                        resetSeenEvents()
                        setCurrentIndex(0)
                        setDisplayLimit(EVENTS_PAGE_SIZE)
                      }}
                    >
                      Reset all
                    </button>
                  )}
                  <button
                    className="events-filter-apply"
                    onClick={() => setFiltersOpen(false)}
                  >
                    Show {allFilteredEvents.length} events
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
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <EmptyStateIllustration variant="events-quiet" size="md" />
            </motion.div>
            <h3>Quiet around here</h3>
            <p>
              Nothing showing up nearby right now. Try a different date, or have a
              look at these platforms for what's on in your area:
            </p>
            <div className="events-alternatives">
              {[
                { label: 'Ticketmaster', url: 'https://www.ticketmaster.co.uk/discover/concerts' },
                { label: 'Skiddle',      url: 'https://www.skiddle.com/whats-on/' },
                { label: 'Ents24',       url: 'https://www.ents24.com/' },
                { label: 'Meetup',       url: 'https://www.meetup.com/find/?source=EVENTS' },
                { label: 'Facebook Events', url: 'https://www.facebook.com/events/' },
              ].map(({ label, url }) => (
                <button
                  key={label}
                  type="button"
                  className="events-alt-link"
                  onClick={() => import('../utils/nativePlugins').then(m => m.openExternalUrl(url))}
                >
                  <span>{label}</span>
                  <ExternalLinkIcon />
                </button>
              ))}
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
                    onClick={() => {
                      resetSeenEvents()
                      setCurrentIndex(0)
                    }}
                  >
                    Start Over
                  </button>
                  <button
                    className="events-refresh-btn-large"
                    onClick={() => {
                      loadEvents()
                      setCurrentIndex(0)
                    }}
                    disabled={loading}
                  >
                    <RefreshIcon /> Check for New Events
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
                      style={{ width: `${((currentIndex + 1) / allFilteredEvents.length) * 100}%` }}
                    />
                  </div>
                  <span className="events-progress-text">
                    {currentIndex + 1} of {allFilteredEvents.length}
                    {loadingMore && ' (loading more...)'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="events-grid-container">
            <div className="events-grid">
              <AnimatePresence>
                {filteredEvents.map((event, index) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: Math.min(index * 0.05, 0.5) }}
                    onClick={() => setSelectedEvent(event)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedEvent(event)
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for ${event.name}`}
                    style={{ cursor: 'pointer' }}
                  >
                    <EventCard event={event} variant="full" />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {(hasMoreToLoad || hasMoreFromServer) && (
              <div className="events-load-more">
                <button
                  className="events-load-more-btn"
                  onClick={loadMoreEvents}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : hasMoreToLoad
                    ? `Load More (${allFilteredEvents.length - filteredEvents.length} remaining)`
                    : hasMoreFromServer
                      ? `Load More Events (${totalAvailable.toLocaleString()} available)`
                      : 'Load More'
                  }
                </button>
              </div>
            )}
            <p className="events-grid-count">
              Showing {filteredEvents.length} of {allFilteredEvents.length} events
              {hasMoreFromServer && totalAvailable > 0 && (
                <span className="events-total-available"> ({totalAvailable.toLocaleString()} available)</span>
              )}
            </p>
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
