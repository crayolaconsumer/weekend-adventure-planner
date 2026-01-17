import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CardStack from '../components/CardStack'
import BoredomBuster from '../components/BoredomBuster'
import PlaceDetail from '../components/PlaceDetail'
import VisitedPrompt from '../components/VisitedPrompt'
import { getPendingVisit, setPendingVisit, clearPendingVisit } from '../utils/pendingVisit'
import { useToast } from '../hooks/useToast'
import { fetchEnrichedPlaces, fetchWeather } from '../utils/apiClient'
import { filterPlaces, enhancePlace, getRandomQualityPlaces } from '../utils/placeFilter'
import { GOOD_CATEGORIES } from '../utils/categories'
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
    <line x1="4" y1="21" x2="4" y2="14"/>
    <line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/>
    <line x1="20" y1="12" x2="20" y2="3"/>
    <line x1="1" y1="14" x2="7" y2="14"/>
    <line x1="9" y1="8" x2="15" y2="8"/>
    <line x1="17" y1="16" x2="23" y2="16"/>
  </svg>
)

export default function Discover({ location }) {
  const toast = useToast()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
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
  const [wishlist, setWishlist] = useState(() => {
    const saved = localStorage.getItem('roam_wishlist')
    return saved ? JSON.parse(saved) : []
  })

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

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('roam_travel_mode', travelMode)
    localStorage.setItem('roam_free_only', showFreeOnly.toString())
    localStorage.setItem('roam_accessibility', accessibilityMode.toString())
  }, [travelMode, showFreeOnly, accessibilityMode])

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

      // Apply smart filters with diversity
      let filtered = filterPlaces(enhanced, {
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        minScore: 30,
        maxResults: 50,
        sortBy: 'smart',
        weather: currentWeather,
        ensureDiversity: selectedCategories.length === 0 // Mix categories when no filter
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

      setPlaces(filtered.slice(0, 30))
    } catch (error) {
      console.error('Failed to load places:', error)
      setPlaces([])
      toast.error("Couldn't load places. Try refreshing.")
    }
    setLoading(false)
  }, [location, travelMode, selectedCategories, showFreeOnly, accessibilityMode, toast])

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
      // Save to wishlist
      const newWishlist = [...wishlist, { ...place, savedAt: Date.now() }]
      setWishlist(newWishlist)
      localStorage.setItem('roam_wishlist', JSON.stringify(newWishlist))
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

  // Boredom Buster - pick a random quality place
  const triggerBoredomBuster = async () => {
    setShowBoredomBuster(true)
    setBoredomLoading(true)
    setBoredomPlace(null)

    // For boredom buster, use closer radius based on mode
    const radius = travelMode === 'driving' ? 15000 : travelMode === 'transit' ? 8000 : 3000

    try {
      const rawPlaces = await fetchEnrichedPlaces(
        location.lat,
        location.lng,
        radius,
        null
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
      toast.error("Surprise me failed. Try again!")
    }

    setBoredomLoading(false)
  }

  const refreshBoredomBuster = async () => {
    setBoredomLoading(true)

    const radius = travelMode === 'driving' ? 15000 : travelMode === 'transit' ? 8000 : 3000

    try {
      const rawPlaces = await fetchEnrichedPlaces(
        location.lat,
        location.lng,
        radius,
        null
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
      toast.error("Couldn't refresh. Try again!")
    }

    setBoredomLoading(false)
  }

  const currentMode = TRAVEL_MODES[travelMode]

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
          <p className="discover-tagline">Discover your next adventure</p>
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
              <h4 className="settings-label">Filters</h4>
              <div className="settings-toggles">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={showFreeOnly}
                    onChange={(e) => setShowFreeOnly(e.target.checked)}
                  />
                  <span className="settings-toggle-slider"></span>
                  <span className="settings-toggle-label">
                    <span>💸</span>
                    Free places only
                  </span>
                </label>

                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={accessibilityMode}
                    onChange={(e) => setAccessibilityMode(e.target.checked)}
                  />
                  <span className="settings-toggle-slider"></span>
                  <span className="settings-toggle-label">
                    <span>♿</span>
                    Accessibility friendly
                  </span>
                </label>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Filters */}
      <div className="discover-filters">
        <div className="discover-filters-scroll">
          {Object.entries(GOOD_CATEGORIES).map(([key, category]) => (
            <button
              key={key}
              className={`chip ${selectedCategories.includes(key) ? 'selected' : ''}`}
              onClick={() => toggleCategory(key)}
              style={{
                '--chip-color': category.color,
                '--chip-color-light': `${category.color}15`,
                '--chip-color-medium': `${category.color}25`,
              }}
            >
              <span>{category.icon}</span>
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active filters indicator */}
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
        onEmpty={() => loadPlaces()}
        onRefresh={() => loadPlaces()}
        onOpenSettings={() => setShowSettings(true)}
        loading={loading}
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
    </div>
  )
}
