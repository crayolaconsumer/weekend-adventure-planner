import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import CardStack from '../components/CardStack'
import BoredomBuster from '../components/BoredomBuster'
import PlaceDetail from '../components/PlaceDetail'
import VisitedPrompt from '../components/VisitedPrompt'
import PlanPrompt from '../components/PlanPrompt'
import FilterModal from '../components/FilterModal'
import UpgradePrompt from '../components/UpgradePrompt'
import { getPendingVisit, setPendingVisit, clearPendingVisit } from '../utils/pendingVisit'
import { useToast } from '../hooks/useToast'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { useTasteProfile } from '../hooks/useTasteProfile'
import { useSponsoredPlaces } from '../hooks/useSponsoredPlaces'
import { useSubscription } from '../hooks/useSubscription'
import { fetchEnrichedPlaces, fetchWeather, fetchPlacesWithSWR, cancelOverpassRequest, createOverpassController } from '../utils/apiClient'
import { filterPlaces, enhancePlace, getRandomQualityPlaces } from '../utils/placeFilter'
import { isPlaceOpen } from '../utils/openingHours'
import { openDirections } from '../utils/navigation'
import './Discover.css'

// Lazy load desktop-only components to keep mobile bundle small
const DiscoverMap = lazy(() => import('../components/DiscoverMap'))
const DiscoverList = lazy(() => import('../components/DiscoverList'))

// Travel mode configurations
const TRAVEL_MODES = {
  // Standard modes (all users)
  walking: { label: 'Walking', icon: '🚶', maxRadius: 5000, speed: 5 },
  driving: { label: 'Driving', icon: '🚗', maxRadius: 30000, speed: 40 },
  transit: { label: 'Transit', icon: '🚌', maxRadius: 15000, speed: 20 },
  // Premium modes (ROAM+ only)
  dayTrip: { label: 'Day Trip', icon: '🗺️', maxRadius: 75000, speed: 60, premium: true },
  explorer: { label: 'Explorer', icon: '🧭', maxRadius: 150000, speed: 80, premium: true }
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

// View mode icons (desktop only)
const StackIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 10h16" />
    <path d="M4 16h16" />
  </svg>
)

const MapIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
    <line x1="8" y1="2" x2="8" y2="18" />
    <line x1="16" y1="6" x2="16" y2="22" />
  </svg>
)

const ListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
)

export default function Discover({ location }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { savePlace, places: savedPlaces } = useSavedPlaces()
  const { profile: userProfile } = useTasteProfile()
  const { sponsoredPlaces } = useSponsoredPlaces(location)
  const { isPremium } = useSubscription()
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)
  const [upgradePromptType, setUpgradePromptType] = useState('saves')
  const [places, setPlaces] = useState([])
  const [basePlaces, setBasePlaces] = useState([])
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
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [viewMode, setViewMode] = useState('swipe') // 'swipe' | 'map' | 'list'
  const [isDesktop, setIsDesktop] = useState(false)
  const latestLoadRequestRef = useRef(0)
  const latestFilterKeyRef = useRef('')
  const basePlacesRef = useRef([])
  const weatherKeyRef = useRef('')
  const categoryDebounceRef = useRef(null) // Debounce timer for category changes

  // Place detail modal state
  const [selectedPlace, setSelectedPlace] = useState(null)

  // Visited prompt state
  const [visitedPromptPlace, setVisitedPromptPlace] = useState(null)

  // Plan prompt state (show after saving, with frequency limit)
  const [planPromptPlace, setPlanPromptPlace] = useState(null)
  const lastPlanPromptRef = useRef(0)

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

  // Premium filters (only available to ROAM+ users)
  const [showLocalsPicks, setShowLocalsPicks] = useState(() => {
    return localStorage.getItem('roam_locals_picks') === 'true'
  })
  const [showOffPeak, setShowOffPeak] = useState(() => {
    return localStorage.getItem('roam_off_peak') === 'true'
  })

  // Persist premium filter settings
  useEffect(() => {
    localStorage.setItem('roam_locals_picks', showLocalsPicks.toString())
  }, [showLocalsPicks])

  useEffect(() => {
    localStorage.setItem('roam_off_peak', showOffPeak.toString())
  }, [showOffPeak])

  const buildFilterKey = useCallback(() => {
    const categoriesKey = [...selectedCategories].sort().join('|')
    return `${travelMode}|${showFreeOnly}|${accessibilityMode}|${showOpenOnly}|${showLocalsPicks}|${showOffPeak}|${categoriesKey}`
  }, [travelMode, showFreeOnly, accessibilityMode, showOpenOnly, showLocalsPicks, showOffPeak, selectedCategories])

  useEffect(() => {
    latestFilterKeyRef.current = buildFilterKey()
  }, [buildFilterKey])

  useEffect(() => {
    basePlacesRef.current = basePlaces
  }, [basePlaces])

  // Memoized filter function - only recreated when absolutely necessary
  const applyFilters = useCallback((list, currentWeather = weather) => {
    if (!list || list.length === 0) return []

    // Early return if no filters active - just use filterPlaces
    const hasActiveFilters = showFreeOnly || accessibilityMode || showOpenOnly ||
      (showLocalsPicks && isPremium) || (showOffPeak && isPremium)

    let filtered = filterPlaces(list, {
      categories: selectedCategories.length > 0 ? selectedCategories : null,
      minScore: 30,
      maxResults: 50,
      sortBy: 'smart',
      weather: currentWeather,
      ensureDiversity: true,
      userProfile
    })

    // Skip additional filtering if no filters active
    if (!hasActiveFilters) return filtered

    // Apply filters in single pass for better performance
    filtered = filtered.filter(p => {
      // Free only filter
      if (showFreeOnly) {
        const isFree = !p.fee || p.fee === 'no' || p.type?.includes('park') || p.type?.includes('viewpoint')
        if (!isFree) return false
      }

      // Accessibility filter
      if (accessibilityMode) {
        const isAccessible = p.wheelchair === 'yes' || p.wheelchair === 'limited' || !p.wheelchair
        if (!isAccessible) return false
      }

      // Open now filter
      if (showOpenOnly) {
        const openStatus = isPlaceOpen(p)
        if (openStatus === false) return false
      }

      // Premium: Locals' picks - filter out tourist traps and chains
      if (showLocalsPicks && isPremium) {
        // Check for tourist trap types
        const isTouristTrap = p.tourism === 'attraction' || p.tourism === 'theme_park'
        if (isTouristTrap) return false

        // Check for known chains
        const isChain = p.brand || p.name?.match(/^(Costa|Starbucks|McDonald|Wetherspoon|Greggs|Pret|Subway|KFC|Burger King|Pizza Hut|Domino|Nando)/i)
        if (isChain) return false

        // Quality score filter - only if score exists and is below threshold
        if (typeof p.qualityScore === 'number' && p.qualityScore < 30) return false
      }

      // Premium: Off-peak times
      if (showOffPeak && isPremium) {
        const now = new Date()
        const hour = now.getHours()
        const isWeekend = now.getDay() === 0 || now.getDay() === 6
        const type = p.type || ''

        if (type.includes('restaurant') || type.includes('cafe')) {
          if ((hour >= 12 && hour <= 14) || (hour >= 18 && hour <= 20)) return false
        } else if (type.includes('park') || type.includes('nature') || type.includes('viewpoint')) {
          if (isWeekend && hour >= 10 && hour <= 16) return false
        } else if (type.includes('museum') || type.includes('attraction') || type.includes('castle')) {
          if (isWeekend && hour >= 11 && hour <= 15) return false
        } else if (type.includes('pub') || type.includes('bar')) {
          if (hour >= 17 && hour <= 21) return false
        }
      }

      return true
    })

    // Sort by quality score if locals picks is active
    if (showLocalsPicks && isPremium) {
      filtered.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    }

    return filtered
  }, [selectedCategories, showFreeOnly, accessibilityMode, showOpenOnly, showLocalsPicks, showOffPeak, isPremium, userProfile, weather])

  // Memoized filtered places - only recalculates when basePlaces or filter deps change
  const filteredPlaces = useMemo(() => {
    if (!basePlaces || basePlaces.length === 0) return []
    return applyFilters(basePlaces, weather)
  }, [basePlaces, applyFilters, weather])

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('roam_travel_mode', travelMode)
    localStorage.setItem('roam_free_only', showFreeOnly.toString())
    localStorage.setItem('roam_accessibility', accessibilityMode.toString())
    localStorage.setItem('roam_open_only', showOpenOnly.toString())
  }, [travelMode, showFreeOnly, accessibilityMode, showOpenOnly])

  // Detect desktop viewport for view mode toggle
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Reset to swipe mode when switching to mobile
  useEffect(() => {
    if (!isDesktop && viewMode !== 'swipe') {
      setViewMode('swipe')
    }
  }, [isDesktop, viewMode])

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
  // Uses SWR pattern for faster initial loads
  // Now works with memoized filtering - only sets basePlaces, useMemo handles the rest
  const loadPlaces = useCallback(async (currentWeather = null) => {
    if (!location) return

    const requestId = ++latestLoadRequestRef.current
    const requestKey = buildFilterKey()
    latestFilterKeyRef.current = requestKey

    setLoading(true)
    const mode = TRAVEL_MODES[travelMode]
    const resolvedWeather = currentWeather ?? weather

    try {
      // Use SWR pattern - returns cached data immediately if available
      // For large radii, onProgress streams places as outer tiles load
      const { data: rawPlaces, stale } = await fetchPlacesWithSWR(
        location.lat,
        location.lng,
        mode.maxRadius,
        selectedCategories.length === 1 ? selectedCategories[0] : null,
        // Background refresh callback - full refresh from cache
        (freshPlaces) => {
          if (requestId === latestLoadRequestRef.current) {
            const enhanced = freshPlaces.map(p => enhancePlace(p, location, { weather: resolvedWeather }))
            setBasePlaces(enhanced)
          }
        },
        // Progressive loading callback - append new places as outer tiles complete
        (newPlaces) => {
          if (requestId === latestLoadRequestRef.current && newPlaces.length > 0) {
            const enhanced = newPlaces.map(p => enhancePlace(p, location, { weather: resolvedWeather }))
            setBasePlaces(prev => {
              // Dedupe by ID
              const existingIds = new Set(prev.map(p => p.id))
              const unique = enhanced.filter(p => !existingIds.has(p.id))
              if (unique.length === 0) return prev
              console.log(`[Discover] +${unique.length} places from outer tiles`)
              return [...prev, ...unique]
            })
          }
        }
      )

      // Context for smart scoring (time of day, weather)
      const scoringContext = { weather: resolvedWeather }

      // Enhance places with context
      const enhanced = rawPlaces.map(p => enhancePlace(p, location, scoringContext))

      if (requestId !== latestLoadRequestRef.current || requestKey !== latestFilterKeyRef.current) {
        return
      }

      // Set basePlaces - the memoized filteredPlaces and useEffect will handle the rest
      setBasePlaces(enhanced)

      // If we served stale data, indicate refresh is happening
      if (stale) {
        console.log('[Discover] Served stale cache, refreshing in background...')
      }
    } catch (error) {
      if (requestId === latestLoadRequestRef.current) {
        console.error('Failed to load places:', error)
        setBasePlaces([])
        toast.error("Couldn't load places. Try refreshing.")
      }
    }
    if (requestId === latestLoadRequestRef.current) {
      setLoading(false)
    }
  }, [location, travelMode, selectedCategories, toast, buildFilterKey, weather])

  // Load more places when running low on cards
  const loadMorePlaces = useCallback(async () => {
    if (!location || loadingMore) return

    const filterKeyAtStart = latestFilterKeyRef.current
    setLoadingMore(true)
    const mode = TRAVEL_MODES[travelMode]

    try {
      // Expand the radius slightly to find more places
      // Premium users can explore up to 200km, free users capped at 50km
      const maxExpandedRadius = isPremium ? 200000 : 50000
      const expandedRadius = Math.min(mode.maxRadius * 1.5, maxExpandedRadius)

      const rawPlaces = await fetchEnrichedPlaces(
        location.lat,
        location.lng,
        expandedRadius,
        selectedCategories.length === 1 ? selectedCategories[0] : null
      )

      // Enhance and filter
      const enhanced = rawPlaces.map(p => enhancePlace(p, location, { weather }))

      let filtered = filterPlaces(enhanced, {
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        minScore: 25, // Lower threshold for more results
        maxResults: 100,
        sortBy: 'smart',
        weather,
        ensureDiversity: true,  // Always ensure category mix
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

      if (filterKeyAtStart !== latestFilterKeyRef.current) {
        return
      }

      setBasePlaces(prev => {
        const existing = new Set(prev.map(p => p.id))
        const merged = [...prev]
        for (const place of enhanced) {
          if (!existing.has(place.id)) {
            existing.add(place.id)
            merged.push(place)
          }
        }
        return merged
      })

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
    } finally {
      setLoadingMore(false)
    }
  }, [location, loadingMore, travelMode, selectedCategories, showFreeOnly, accessibilityMode, showOpenOnly, weather, seenPlaceIds, userProfile, isPremium])

  // Sync places state with memoized filtered results
  // This is more efficient than the old useEffect because filteredPlaces
  // only changes when basePlaces or actual filter values change
  useEffect(() => {
    if (filteredPlaces.length === 0 && basePlaces.length === 0) return

    // Only update if filteredPlaces actually changed
    setPlaces(prevPlaces => {
      // Check if the filtered results are actually different
      if (prevPlaces.length === filteredPlaces.length &&
          prevPlaces[0]?.id === filteredPlaces[0]?.id) {
        return prevPlaces
      }

      const newSeenIds = new Set(filteredPlaces.map(p => p.id))
      setSeenPlaceIds(newSeenIds)
      setFetchOffset(filteredPlaces.length)
      return filteredPlaces
    })
  }, [filteredPlaces, basePlaces.length])

  // Load places when location or travel mode changes
  // Category changes are handled by toggleCategory with debouncing

  useEffect(() => {
    if (!location) return

    // Load weather once, then load places
    // Weather is loaded independently to avoid cascading fetches
    let isCancelled = false

    const load = async () => {
      const weatherKey = `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`
      let currentWeather = weather

      if (weatherKeyRef.current !== weatherKey) {
        try {
          currentWeather = await fetchWeather(location.lat, location.lng)
          if (!isCancelled) {
            setWeather(currentWeather)
            weatherKeyRef.current = weatherKey
          }
        } catch (error) {
          console.error('Failed to load weather:', error)
        }
      }

      // Then load places with the weather context
      if (!isCancelled) {
        loadPlaces(currentWeather)
      }
    }

    load()

    return () => {
      isCancelled = true
      // Clean up any pending category debounce
      clearTimeout(categoryDebounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- category changes handled by debounced toggleCategory
  }, [location?.lat, location?.lng, travelMode])

  // Handle category changes with initial load
  // This effect ONLY runs on initial mount to load with saved categories
  // Subsequent category changes are handled by the debounced toggleCategory
  const initialCategoryLoadRef = useRef(false)
  useEffect(() => {
    if (!location || initialCategoryLoadRef.current) return
    if (selectedCategories.length > 0) {
      // Has saved categories from onboarding - load is already triggered by location effect
      initialCategoryLoadRef.current = true
    }
  }, [location, selectedCategories.length])


  // Handle category filter changes with debouncing
  // Rapid toggles won't spam the API - we wait for user to finish selecting
  const toggleCategory = (categoryKey) => {
    setSelectedCategories(prev => {
      const newSelection = prev.includes(categoryKey)
        ? prev.filter(k => k !== categoryKey)
        : [...prev, categoryKey]
      return newSelection
    })

    // Cancel any pending API request from previous toggle
    cancelOverpassRequest()

    // Debounce the API call - wait for user to finish toggling
    clearTimeout(categoryDebounceRef.current)
    categoryDebounceRef.current = setTimeout(() => {
      loadPlaces(weather)
    }, 300) // 300ms debounce - fast enough to feel responsive
  }

  const clearAllFilters = () => {
    setSelectedCategories([])
    setShowFreeOnly(false)
    setAccessibilityMode(false)
    setShowOpenOnly(false)
    setShowLocalsPicks(false)
    setShowOffPeak(false)
  }

  // Handle swipe actions
  const handleSwipe = (action, place) => {
    if (action === 'like') {
      // CHECK SAVE LIMIT FOR FREE USERS
      const currentSaveCount = savedPlaces?.length || 0
      if (!isPremium && currentSaveCount >= 10) {
        setUpgradePromptType('saves')
        setShowUpgradePrompt(true)
        return // Don't save - show upgrade prompt instead
      }

      // Save to wishlist (hook handles localStorage vs API)
      savePlace(place)

      // SOFT PROMPT AT 5TH SAVE (success moment)
      const newSaveCount = currentSaveCount + 1
      if (newSaveCount === 5 && !isPremium) {
        toast.success(
          <span>
            5 places saved!{' '}
            <button
              onClick={() => navigate('/pricing')}
              style={{
                textDecoration: 'underline',
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                font: 'inherit'
              }}
            >
              Upgrade for unlimited →
            </button>
          </span>
        )
      }

      // Show plan prompt occasionally (not every save - every 3rd or after 30s)
      const now = Date.now()
      const timeSinceLastPrompt = now - lastPlanPromptRef.current
      const saveCount = parseInt(localStorage.getItem('roam_save_count') || '0', 10) + 1
      localStorage.setItem('roam_save_count', String(saveCount))

      // Show prompt every 3rd save OR if more than 30 seconds since last prompt
      if (saveCount % 3 === 0 || timeSinceLastPrompt > 30000) {
        lastPlanPromptRef.current = now
        // Small delay so user sees the swipe complete
        setTimeout(() => setPlanPromptPlace(place), 400)
      }
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

        {/* Filter Button */}
        <button
          className="discover-settings-btn"
          onClick={() => setShowFilterModal(true)}
          aria-label="Open filters"
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
          </button>
        </div>
      </header>

      {/* Active filters indicator (desktop only, mobile shows in trigger) */}
      {(showFreeOnly || accessibilityMode || showOpenOnly) && (
        <div className="discover-active-filters">
          {showFreeOnly && <span className="active-filter">💸 Free only</span>}
          {accessibilityMode && <span className="active-filter">♿ Accessible</span>}
          {showOpenOnly && <span className="active-filter">🕐 Open now</span>}
        </div>
      )}

      {/* View Mode Toggle (desktop only) */}
      {isDesktop && (
        <div className="discover-view-toggle" role="group" aria-label="View mode">
          <button
            className={`view-toggle-btn ${viewMode === 'swipe' ? 'active' : ''}`}
            onClick={() => setViewMode('swipe')}
            aria-pressed={viewMode === 'swipe'}
            aria-label="Card stack view"
          >
            <StackIcon />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => setViewMode('map')}
            aria-pressed={viewMode === 'map'}
            aria-label="Map view"
          >
            <MapIcon />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            aria-pressed={viewMode === 'list'}
            aria-label="List view"
          >
            <ListIcon />
          </button>
        </div>
      )}

      {/* Main Content Area - conditionally render based on view mode */}
      <div className={`discover-content ${isDesktop ? `view-${viewMode}` : ''}`}>
        {/* Card Stack (always on mobile, conditional on desktop) */}
        {(viewMode === 'swipe' || !isDesktop) && (
          <CardStack
            places={places}
            sponsoredPlaces={sponsoredPlaces}
            userLocation={location}
            onSwipe={handleSwipe}
            onExpand={(place) => setSelectedPlace(place)}
            onEmpty={() => {}}
            onRefresh={() => loadPlaces(weather)}
            onOpenSettings={() => setShowFilterModal(true)}
            onLoadMore={loadMorePlaces}
            loading={loading}
            loadingMore={loadingMore}
          />
        )}

        {/* Map View (desktop only) */}
        {isDesktop && viewMode === 'map' && (
          <Suspense fallback={<div className="discover-view-loading">Loading map...</div>}>
            <DiscoverMap
              places={places}
              userLocation={location}
              selectedPlace={selectedPlace}
              onSelectPlace={setSelectedPlace}
            />
          </Suspense>
        )}

        {/* List View (desktop only) */}
        {isDesktop && viewMode === 'list' && (
          <Suspense fallback={<div className="discover-view-loading">Loading list...</div>}>
            <DiscoverList
              places={places}
              selectedPlace={selectedPlace}
              onSelectPlace={setSelectedPlace}
              onSavePlace={savePlace}
              onGoPlace={(place) => openDirections(place.lat, place.lng, place.name)}
              onLoadMore={loadMorePlaces}
              loading={loadingMore}
            />
          </Suspense>
        )}
      </div>

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

      {/* Plan Prompt - shown after saving a place */}
      <AnimatePresence>
        {planPromptPlace && (
          <PlanPrompt
            place={planPromptPlace}
            onClose={() => setPlanPromptPlace(null)}
            onAddToPlan={() => setPlanPromptPlace(null)}
          />
        )}
      </AnimatePresence>

      {/* Filter Modal */}
      <FilterModal
        isOpen={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        travelMode={travelMode}
        travelModes={TRAVEL_MODES}
        onTravelModeChange={setTravelMode}
        selectedCategories={selectedCategories}
        onToggleCategory={toggleCategory}
        showFreeOnly={showFreeOnly}
        onToggleFreeOnly={() => setShowFreeOnly(prev => !prev)}
        accessibilityMode={accessibilityMode}
        onToggleAccessibility={() => setAccessibilityMode(prev => !prev)}
        showOpenOnly={showOpenOnly}
        onToggleOpenOnly={() => setShowOpenOnly(prev => !prev)}
        showLocalsPicks={showLocalsPicks}
        onToggleLocalsPicks={() => setShowLocalsPicks(prev => !prev)}
        showOffPeak={showOffPeak}
        onToggleOffPeak={() => setShowOffPeak(prev => !prev)}
        onClearAll={clearAllFilters}
        isPremium={isPremium}
        onShowUpgrade={(type = 'filters') => {
          setShowFilterModal(false)
          setUpgradePromptType(type)
          setShowUpgradePrompt(true)
        }}
      />

      {/* Upgrade Prompt for premium features */}
      <UpgradePrompt
        type={upgradePromptType}
        isOpen={showUpgradePrompt}
        onClose={() => setShowUpgradePrompt(false)}
      />
    </div>
  )
}
