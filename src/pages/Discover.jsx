import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CardStack from '../components/CardStack'
import BoredomBuster from '../components/BoredomBuster'
import PlaceDetail from '../components/PlaceDetail'
import VisitedPrompt from '../components/VisitedPrompt'
import FilterModal from '../components/FilterModal'
import { getPendingVisit, setPendingVisit, clearPendingVisit } from '../utils/pendingVisit'
import { useToast } from '../hooks/useToast'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { useTasteProfile } from '../hooks/useTasteProfile'
import { fetchEnrichedPlaces, fetchWeather } from '../utils/apiClient'
import { filterPlaces, enhancePlace, getRandomQualityPlaces } from '../utils/placeFilter'
import { GOOD_CATEGORIES } from '../utils/categories'
import { isPlaceOpen } from '../utils/openingHours'
import './Discover.css'

// Travel mode configurations
const TRAVEL_MODES = {
  walking: { label: 'Walking', icon: '🚶', maxRadius: 5000, speed: 5 },
  driving: { label: 'Driving', icon: '🚗', maxRadius: 30000, speed: 40 },
  transit: { label: 'Transit', icon: '🚌', maxRadius: 15000, speed: 20 }
}

// Settings icon
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
)

export default function Discover({ location }) {
  const toast = useToast()
  const { savePlace } = useSavedPlaces()
  const { profile: userProfile } = useTasteProfile()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [seenPlaceIds, setSeenPlaceIds] = useState(new Set())
  const [, setFetchOffset] = useState(0)
  const [weather, setWeather] = useState(null)
  const [selectedCategories, setSelectedCategories] = useState(() => {
    // Load saved interests from onboarding
    const saved = localStorage.getItem('roam_interests')
    return saved ? JSON.parse(saved) : []
  })
  const [showBoredomBuster, setShowBoredomBuster] = useState(false)
  const [boredomPlace, setBoredomPlace] = useState(null)
  const [boredomLoading, setBoredomLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFilterModal, setShowFilterModal] = useState(false)

  // Place detail modal state
  const [selectedPlace, setSelectedPlace] = useState(null)

  // Visited prompt state
  const [visitedPromptPlace, setVisitedPromptPlace] = useState(null)

  // Settings state
  const [travelMode, setTravelMode] = useState(() => {
    return localStorage.getItem('roam_travel_mode') || 'walking'
  })
  const [showFreeOnly, setShowFreeOnly] = useState(() => {
    return localStorage.getItem('roam_free_only') === 'true'
  })
  const [accessibilityMode, setAccessibilityMode] = useState(() => {
    return localStorage.getItem('roam_accessibility') === 'true'
  })
  const [showOpenOnly, setShowOpenOnly] = useState(() => {
    return localStorage.getItem('roam_open_only') === 'true'
  })

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('roam_travel_mode', travelMode)
    localStorage.setItem('roam_free_only', showFreeOnly.toString())
    localStorage.setItem('roam_accessibility', accessibilityMode.toString())
    localStorage.setItem('roam_open_only', showOpenOnly.toString())
  }, [travelMode, showFreeOnly, accessibilityMode, showOpenOnly])

  // Check for pending visit prompt on mount and when page becomes visible
  useEffect(() => {
    const checkPendingVisit = () => {
      const pending = getPendingVisit()
      if (pending) {
        setVisitedPromptPlace(pending)
      }
    }

    // Check on mount
    checkPendingVisit()

    // Check when page becomes visible again (user returns from maps)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPendingVisit()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Define loadPlaces before the effect that calls it
  // Note: weather is intentionally NOT a dependency to prevent cascading reloads
  const loadPlaces = useCallback(async (currentWeather = null) => {
    if (!location) return

    setLoading(true)
    const mode = TRAVEL_MODES[travelMode]

    try {
      // Fetch from multiple sources (OSM + OpenTripMap)
      const rawPlaces = await fetchEnrichedPlaces(
        location.lat,
        location.lng,
        mode.maxRadius,
        selectedCategories.length === 1 ? selectedCategories[0] : null
      )

      // Context for smart scoring (time of day, weather)
      const scoringContext = { weather: currentWeather }

      // Enhance and filter places with context
      let enhanced = rawPlaces.map(p => enhancePlace(p, location, scoringContext))

      // Apply smart filters with diversity and personalization
      let filtered = filterPlaces(enhanced, {
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        minScore: 30,
        maxResults: 50,
        sortBy: 'smart',
        weather: currentWeather,
        ensureDiversity: selectedCategories.length === 0, // Mix categories when no filter
        userProfile // Personalize based on user's taste profile
      })

      // Filter for free places if enabled
      if (showFreeOnly) {
        filtered = filtered.filter(p =>
          !p.fee || p.fee === 'no' || p.type?.includes('park') || p.type?.includes('viewpoint')
        )
      }

      // Filter for accessibility if enabled
      if (accessibilityMode) {
        filtered = filtered.filter(p =>
          p.wheelchair === 'yes' || p.wheelchair === 'limited' || !p.wheelchair
        )
      }

      // Filter for open places only if enabled
      if (showOpenOnly) {
        filtered = filtered.filter(p => {
          const openStatus = isPlaceOpen(p)
          // Include if open, or if status is unknown (null)
          return openStatus === true || openStatus === null
        })
      }

      // Reset seen IDs and offset on fresh load
      const newSeenIds = new Set(filtered.map(p => p.id))
      setSeenPlaceIds(newSeenIds)
      setFetchOffset(filtered.length)
      setPlaces(filtered)
    } catch (error) {
      console.error('Failed to load places:', error)
      setPlaces([])
      toast.error("Couldn't load places. Try refreshing.")
    }
    setLoading(false)
  }, [location, travelMode, selectedCategories, showFreeOnly, accessibilityMode, showOpenOnly, toast, userProfile])

  // Load more places when running low on cards
  const loadMorePlaces = useCallback(async () => {
    if (!location || loadingMore) return

    setLoadingMore(true)
    const mode = TRAVEL_MODES[travelMode]

    try {
      // Expand the radius slightly to find more places
      const expandedRadius = Math.min(mode.maxRadius * 1.5, 50000)

      const rawPlaces = await fetchEnrichedPlaces(
        location.lat,
        location.lng,
        expandedRadius,
        selectedCategories.length === 1 ? selectedCategories[0] : null
      )

      // Enhance and filter
      let enhanced = rawPlaces.map(p => enhancePlace(p, location, { weather }))

      let filtered = filterPlaces(enhanced, {
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        minScore: 25, // Lower threshold for more results
        maxResults: 100,
        sortBy: 'smart',
        weather,
        ensureDiversity: selectedCategories.length === 0,
        userProfile // Personalize based on user's taste profile
      })

      // Apply user filters
      if (showFreeOnly) {
        filtered = filtered.filter(p =>
          !p.fee || p.fee === 'no' || p.type?.includes('park') || p.type?.includes('viewpoint')
        )
      }
      if (accessibilityMode) {
        filtered = filtered.filter(p =>
          p.wheelchair === 'yes' || p.wheelchair === 'limited' || !p.wheelchair
        )
      }
      if (showOpenOnly) {
        filtered = filtered.filter(p => {
          const openStatus = isPlaceOpen(p)
          return openStatus === true || openStatus === null
        })
      }

      // Filter out places we've already shown
      const newPlaces = filtered.filter(p => !seenPlaceIds.has(p.id))

      if (newPlaces.length > 0) {
        // Update seen IDs
        const updatedSeenIds = new Set(seenPlaceIds)
        newPlaces.forEach(p => updatedSeenIds.add(p.id))
        setSeenPlaceIds(updatedSeenIds)
        setFetchOffset(prev => prev + newPlaces.length)

        // Append new places to existing list
        setPlaces(prev => [...prev, ...newPlaces])
      }
    } catch (error) {
      console.error('Failed to load more places:', error)
    }

    setLoadingMore(false)
  }, [location, loadingMore, travelMode, selectedCategories, showFreeOnly, accessibilityMode, showOpenOnly, weather, seenPlaceIds, userProfile])

  // Load places when location or settings change

  useEffect(() => {
    if (!location) return

    // Load weather once, then load places
    // Weather is loaded independently to avoid cascading fetches
    let isCancelled = false

    const load = async () => {
      // Fetch weather first (quick)
      let currentWeather = null
      try {
        currentWeather = await fetchWeather(location.lat, location.lng)
        if (!isCancelled) {
          setWeather(currentWeather)
        }
      } catch (error) {
        console.error('Failed to load weather:', error)
      }

      // Then load places with the weather context
      if (!isCancelled) {
        loadPlaces(currentWeather)
      }
    }

    load()

    return () => {
      isCancelled = true
    }
  }, [location, travelMode, selectedCategories, showFreeOnly, accessibilityMode, loadPlaces])


  // Handle category filter changes
  const toggleCategory = (categoryKey) => {
    setSelectedCategories(prev => {
      const newSelection = prev.includes(categoryKey)
        ? prev.filter(k => k !== categoryKey)
        : [...prev, categoryKey]
      return newSelection
    })
  }

  // Handle swipe actions
  const handleSwipe = (action, place) => {
    if (action === 'like') {
      // Save to wishlist (hook handles localStorage vs API)
      savePlace(place)
    }

    // Track negative signals for "not interested" personalization
    if (action === 'nope') {
      const notInterested = JSON.parse(localStorage.getItem('roam_not_interested') || '[]')
      const categoryKey = place.category?.key || place.categoryKey
      const placeType = place.type

      // Track the skip with timestamp (keep last 50)
      notInterested.push({
        categoryKey,
        placeType,
        timestamp: Date.now()
      })

      // Keep only last 50 to avoid localStorage bloat
      if (notInterested.length > 50) {
        notInterested.shift()
      }

      localStorage.setItem('roam_not_interested', JSON.stringify(notInterested))
    }

    // Track for analytics/stats
    const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
    stats.totalSwipes = (stats.totalSwipes || 0) + 1
    if (action === 'go') {
      stats.timesWentOut = (stats.timesWentOut || 0) + 1
      stats.lastActivityDate = new Date().toISOString()

      // Save as pending visit for later prompt
      setPendingVisit(place)

      // Update streak
      const today = new Date().toDateString()
      const lastDate = stats.lastStreakDate
      if (lastDate !== today) {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        if (lastDate === yesterday.toDateString()) {
          stats.currentStreak = (stats.currentStreak || 0) + 1
        } else {
          stats.currentStreak = 1
        }
        stats.lastStreakDate = today
        stats.bestStreak = Math.max(stats.bestStreak || 0, stats.currentStreak)
      }
    }
    localStorage.setItem('roam_stats', JSON.stringify(stats))
  }

  // Helper: fetch with timeout for BoredomBuster
  const fetchWithTimeout = async (fetchFn, timeoutMs = 15000) => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
    )
    return Promise.race([fetchFn(), timeoutPromise])
  }

  // Boredom Buster - pick a random quality place
  const triggerBoredomBuster = async () => {
    setShowBoredomBuster(true)
    setBoredomLoading(true)
    setBoredomPlace(null)

    // For boredom buster, use closer radius based on mode
    const radius = travelMode === 'driving' ? 15000 : travelMode === 'transit' ? 8000 : 3000

    try {
      const rawPlaces = await fetchWithTimeout(() =>
        fetchEnrichedPlaces(location.lat, location.lng, radius, null)
      )

      let enhanced = rawPlaces.map(p => enhancePlace(p, location))

      // Apply same filters
      if (showFreeOnly) {
        enhanced = enhanced.filter(p =>
          !p.fee || p.fee === 'no' || p.type?.includes('park') || p.type?.includes('viewpoint')
        )
      }
      if (accessibilityMode) {
        enhanced = enhanced.filter(p =>
          p.wheelchair === 'yes' || p.wheelchair === 'limited' || !p.wheelchair
        )
      }

      const quality = getRandomQualityPlaces(enhanced, 1, { minScore: 35 })

      if (quality.length > 0) {
        setBoredomPlace(quality[0])
      }
    } catch (error) {
      console.error('Boredom buster failed:', error)
      if (error.message === 'Request timed out') {
        toast.error("Taking too long. Please try again!")
      } else {
        toast.error("Surprise me failed. Try again!")
      }
    }

    setBoredomLoading(false)
  }

  const refreshBoredomBuster = async () => {
    setBoredomLoading(true)

    const radius = travelMode === 'driving' ? 15000 : travelMode === 'transit' ? 8000 : 3000

    try {
      const rawPlaces = await fetchWithTimeout(() =>
        fetchEnrichedPlaces(location.lat, location.lng, radius, null)
      )

      let enhanced = rawPlaces.map(p => enhancePlace(p, location))

      if (showFreeOnly) {
        enhanced = enhanced.filter(p =>
          !p.fee || p.fee === 'no' || p.type?.includes('park') || p.type?.includes('viewpoint')
        )
      }
      if (accessibilityMode) {
        enhanced = enhanced.filter(p =>
          p.wheelchair === 'yes' || p.wheelchair === 'limited' || !p.wheelchair
        )
      }

      const quality = getRandomQualityPlaces(enhanced, 1, { minScore: 35 })

      if (quality.length > 0) {
        setBoredomPlace(quality[0])
      }
    } catch (error) {
      console.error('Refresh failed:', error)
      if (error.message === 'Request timed out') {
        toast.error("Taking too long. Please try again!")
      } else {
        toast.error("Couldn't refresh. Try again!")
      }
    }

    setBoredomLoading(false)
  }

  const currentMode = TRAVEL_MODES[travelMode]

  // Show a location-pending state when waiting for geolocation
  if (!location) {
    return (
      <div className="page discover-page">
        <header className="discover-header">
          <motion.div
            className="discover-hero"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="discover-wordmark">ROAM</h1>
            <p className="discover-tagline">Stop scrolling. Start roaming.</p>
          </motion.div>
        </header>

        <div className="discover-location-pending">
          <motion.div
            className="location-pending-icon"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            📍
          </motion.div>
          <h3>Getting your location...</h3>
          <p>This helps us find places near you</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page discover-page">
      {/* Hero / Header */}
      <header className="discover-header">
        <motion.div
          className="discover-hero"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="discover-wordmark">ROAM</h1>
          <p className="discover-tagline">Stop scrolling. Start roaming.</p>
        </motion.div>

        {/* Settings Button */}
        <button
          className="discover-settings-btn"
          onClick={() => setShowSettings(!showSettings)}
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>

        {/* Boredom Buster Button - THE HERO */}
        <motion.button
          className="boredom-btn"
          onClick={triggerBoredomBuster}
          disabled={!location}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.03, y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={{
            delay: 0.2,
            type: 'spring',
            stiffness: 300,
            damping: 20
          }}
        >
          <div className="boredom-btn-content">
            <motion.span
              className="boredom-btn-emoji"
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            >
              🎲
            </motion.span>
            <span className="boredom-btn-text">I'm Bored</span>
          </div>
        </motion.button>

        {/* Weather & Mode indicator */}
        <div className="discover-status">
          {weather && (
            <div className="discover-weather">
              <span>{Math.round(weather.temperature)}°</span>
              <span>{weather.description}</span>
            </div>
          )}
          <div className="discover-mode">
            <span>{currentMode.icon}</span>
            <span>{currentMode.label}</span>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            className="discover-settings-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="settings-section">
              <h4 className="settings-label">Travel Mode</h4>
              <div className="settings-options">
                {Object.entries(TRAVEL_MODES).map(([key, mode]) => (
                  <button
                    key={key}
                    className={`settings-option ${travelMode === key ? 'active' : ''}`}
                    onClick={() => setTravelMode(key)}
                  >
                    <span className="settings-option-icon">{mode.icon}</span>
                    <span>{mode.label}</span>
                    <span className="settings-option-detail">
                      Up to {mode.maxRadius / 1000}km
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <h4 className="settings-label" id="settings-filters-label">Filters</h4>
              <div className="settings-toggles" role="group" aria-labelledby="settings-filters-label">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={showFreeOnly}
                    checked={showFreeOnly}
                    onChange={(e) => setShowFreeOnly(e.target.checked)}
                  />
                  <span className="settings-toggle-slider" aria-hidden="true"></span>
                  <span className="settings-toggle-label">
                    <span aria-hidden="true">💸</span>
                    Free places only
                  </span>
                </label>

                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={accessibilityMode}
                    checked={accessibilityMode}
                    onChange={(e) => setAccessibilityMode(e.target.checked)}
                  />
                  <span className="settings-toggle-slider" aria-hidden="true"></span>
                  <span className="settings-toggle-label">
                    <span aria-hidden="true">♿</span>
                    Accessibility friendly
                  </span>
                </label>

                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={showOpenOnly}
                    checked={showOpenOnly}
                    onChange={(e) => setShowOpenOnly(e.target.checked)}
                  />
                  <span className="settings-toggle-slider" aria-hidden="true"></span>
                  <span className="settings-toggle-label">
                    <span aria-hidden="true">🕐</span>
                    Open now only
                  </span>
                </label>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Filters - Mobile trigger + Desktop scroll */}
      <div className="discover-filters">
        {/* Mobile: Compact trigger button */}
        <button
          className="discover-filters-trigger"
          onClick={() => setShowFilterModal(true)}
          aria-label="Open filter options"
        >
          <span className="discover-filters-trigger-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </span>
          <span className="discover-filters-trigger-text">
            {selectedCategories.length > 0
              ? `${selectedCategories.length} filter${selectedCategories.length !== 1 ? 's' : ''}`
              : 'All categories'}
          </span>
          {(selectedCategories.length > 0 || showFreeOnly || accessibilityMode) && (
            <span className="discover-filters-trigger-badge">
              {selectedCategories.length + (showFreeOnly ? 1 : 0) + (accessibilityMode ? 1 : 0)}
            </span>
          )}
        </button>

        {/* Desktop: Horizontal scroll (hidden on mobile) */}
        <div className="discover-filters-scroll" role="group" aria-label="Filter by category">
          {Object.entries(GOOD_CATEGORIES).map(([key, category]) => (
            <button
              key={key}
              className={`chip ${selectedCategories.includes(key) ? 'selected' : ''}`}
              onClick={() => toggleCategory(key)}
              aria-pressed={selectedCategories.includes(key)}
              style={{
                '--chip-color': category.color,
                '--chip-color-light': `${category.color}15`,
                '--chip-color-medium': `${category.color}25`,
              }}
            >
              <span aria-hidden="true">{category.icon}</span>
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active filters indicator (desktop only, mobile shows in trigger) */}
      {(showFreeOnly || accessibilityMode) && (
        <div className="discover-active-filters">
          {showFreeOnly && <span className="active-filter">💸 Free only</span>}
          {accessibilityMode && <span className="active-filter">♿ Accessible</span>}
        </div>
      )}

      {/* Card Stack */}
      <CardStack
        places={places}
        onSwipe={handleSwipe}
        onExpand={(place) => setSelectedPlace(place)}
        onEmpty={() => {}}
        onRefresh={() => loadPlaces()}
        onOpenSettings={() => setShowSettings(true)}
        onLoadMore={loadMorePlaces}
        loading={loading}
        loadingMore={loadingMore}
      />

      {/* Boredom Buster Overlay */}
      {showBoredomBuster && (
        <BoredomBuster
          place={boredomPlace}
          weather={weather}
          loading={boredomLoading}
          travelMode={travelMode}
          onRefresh={refreshBoredomBuster}
          onGo={() => {
            // Track it - Boredom Buster should count as going out and update streaks
            const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
            stats.boredomBusts = (stats.boredomBusts || 0) + 1
            stats.timesWentOut = (stats.timesWentOut || 0) + 1
            stats.lastActivityDate = new Date().toISOString()

            // Update streak (same logic as regular "go" action)
            const today = new Date().toDateString()
            const lastDate = stats.lastStreakDate
            if (lastDate !== today) {
              const yesterday = new Date()
              yesterday.setDate(yesterday.getDate() - 1)
              if (lastDate === yesterday.toDateString()) {
                stats.currentStreak = (stats.currentStreak || 0) + 1
              } else {
                stats.currentStreak = 1
              }
              stats.lastStreakDate = today
              stats.bestStreak = Math.max(stats.bestStreak || 0, stats.currentStreak)
            }

            localStorage.setItem('roam_stats', JSON.stringify(stats))
          }}
          onClose={() => setShowBoredomBuster(false)}
        />
      )}

      {/* Place Detail Modal */}
      <AnimatePresence>
        {selectedPlace && (
          <PlaceDetail
            place={selectedPlace}
            onClose={() => setSelectedPlace(null)}
            onGo={(place) => {
              // Track as going out
              const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
              stats.timesWentOut = (stats.timesWentOut || 0) + 1
              stats.lastActivityDate = new Date().toISOString()

              // Save as pending visit for later prompt
              setPendingVisit(place)

              const today = new Date().toDateString()
              const lastDate = stats.lastStreakDate
              if (lastDate !== today) {
                const yesterday = new Date()
                yesterday.setDate(yesterday.getDate() - 1)
                if (lastDate === yesterday.toDateString()) {
                  stats.currentStreak = (stats.currentStreak || 0) + 1
                } else {
                  stats.currentStreak = 1
                }
                stats.lastStreakDate = today
                stats.bestStreak = Math.max(stats.bestStreak || 0, stats.currentStreak)
              }

              localStorage.setItem('roam_stats', JSON.stringify(stats))
              setSelectedPlace(null)
            }}
          />
        )}
      </AnimatePresence>

      {/* Visited Prompt Modal */}
      <AnimatePresence>
        {visitedPromptPlace && (
          <VisitedPrompt
            place={visitedPromptPlace}
            userLocation={location}
            onConfirm={() => {
              clearPendingVisit()
            }}
            onDismiss={() => {
              setVisitedPromptPlace(null)
              clearPendingVisit()
            }}
          />
        )}
      </AnimatePresence>

      {/* Filter Modal */}
      <FilterModal
        isOpen={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        selectedCategories={selectedCategories}
        onToggleCategory={toggleCategory}
        showFreeOnly={showFreeOnly}
        onToggleFreeOnly={() => setShowFreeOnly(prev => !prev)}
        accessibilityMode={accessibilityMode}
        onToggleAccessibility={() => setAccessibilityMode(prev => !prev)}
      />
    </div>
  )
}
