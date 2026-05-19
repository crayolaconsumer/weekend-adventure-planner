import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import CardStack from '../components/CardStack'
import PlaceDetail from '../components/PlaceDetail'
import VisitedPrompt from '../components/VisitedPrompt'
import PlanPrompt from '../components/PlanPrompt'
import FilterModal from '../components/FilterModal'
import UpgradePrompt from '../components/UpgradePrompt'
import JustGoModal from '../components/JustGoModal'
import { getPendingVisit, setPendingVisit, clearPendingVisit } from '../utils/pendingVisit'
import { useToast } from '../hooks/useToast'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { useTasteProfile } from '../hooks/useTasteProfile'
import { useSponsoredPlaces } from '../hooks/useSponsoredPlaces'
import { useSubscription } from '../hooks/useSubscription'
import { useSwipedPlaces } from '../hooks/useSwipedPlaces'
import { useUserStats } from '../hooks/useUserStats'
import { fetchEnrichedPlaces, fetchWeather, fetchPlacesWithSWR, cancelOverpassRequest, fetchPlaceById, enrichPlace as apiEnrichPlace } from '../utils/apiClient'
import { filterPlaces, enhancePlace } from '../utils/placeFilter'
import { hasCacheSync, makeCacheKey } from '../utils/geoCache'
import { useFriendPlaceActivity } from '../hooks/useFriendActivity'
import { isPlaceOpen } from '../utils/openingHours'
import { openDirections } from '../utils/navigation'
import { getTopRecommendations } from '../utils/tasteProfile'
import { TRAVEL_MODES, DEFAULT_LOCATION, LOCATION_TIMEOUT_MS } from './Discover/constants'
import { StackIcon, MapIcon, ListIcon } from './Discover/icons'
import { applyDiscoverFilters, buildFilterKey as buildFilterKeyPure } from './Discover/applyFilters'
import { DEFAULT_BAND, bandStorageKey, getBandsFor } from './Discover/distanceBands'
import { buildWentOutPatch } from './Discover/stats'
import ErrorRecovery from './Discover/ErrorRecovery'
import DiscoverHeader from './Discover/DiscoverHeader'
import './Discover.css'

// Lazy load desktop-only components to keep mobile bundle small
const DiscoverMap = lazy(() => import('../components/DiscoverMap'))
const DiscoverList = lazy(() => import('../components/DiscoverList'))

export default function Discover({ location }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { savePlace, places: savedPlaces } = useSavedPlaces()
  const { profile: userProfile } = useTasteProfile()
  const { isPremium } = useSubscription()
  const { recordSwipe } = useSwipedPlaces()
  const { stats, incrementStat, updateStats } = useUserStats()
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)
  const [upgradePromptType, setUpgradePromptType] = useState('saves')
  const [places, setPlaces] = useState([])
  const [basePlaces, setBasePlaces] = useState([])

  // Location timeout state - tracks if we've been waiting too long for geolocation
  const [locationTimeout, setLocationTimeout] = useState(false)
  const [usingFallbackLocation, setUsingFallbackLocation] = useState(false)
  const [fallbackLocation, setFallbackLocation] = useState(null)

  // Must be after fallbackLocation declaration
  const { sponsoredPlaces } = useSponsoredPlaces(location || fallbackLocation)

  // Get friend activity for places (for friend chips and boost scoring)
  const placeIds = useMemo(() => basePlaces.map(p => p.id), [basePlaces])
  const { activityMap: friendActivity } = useFriendPlaceActivity(placeIds)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [seenPlaceIds, setSeenPlaceIds] = useState(new Set())
  const [, setFetchOffset] = useState(0)
  const [weather, setWeather] = useState(null)
  const [selectedCategories, setSelectedCategories] = useState(() => {
    // Load saved interests from onboarding
    const saved = localStorage.getItem('roam_interests')
    return saved ? JSON.parse(saved) : []
  })
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [showJustGo, setShowJustGo] = useState(false)
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

  // Distance band — independent of travel mode but stored per-mode so
  // each mode remembers its own last-used band. "Long walk" and "long
  // drive" feel like different intents, so the user shouldn't have to
  // re-set the band every time they switch how they're travelling.
  const [selectedBand, setSelectedBand] = useState(() => {
    const initialMode = localStorage.getItem('roam_travel_mode') || 'walking'
    return localStorage.getItem(bandStorageKey(initialMode)) || DEFAULT_BAND
  })

  // When travel mode changes, restore that mode's saved band (or fall
  // back to the default). This is the read-side of the per-mode
  // persistence — the write-side lives in the band's onChange.
  useEffect(() => {
    const saved = localStorage.getItem(bandStorageKey(travelMode))
    setSelectedBand(saved || DEFAULT_BAND)
  }, [travelMode])

  const handleBandChange = useCallback((nextBand) => {
    setSelectedBand(nextBand)
    localStorage.setItem(bandStorageKey(travelMode), nextBand)
  }, [travelMode])

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

  // Location timeout effect - show recovery options if location takes too long
  useEffect(() => {
    // Only run timeout when we don't have a location and aren't using fallback
    if (location || usingFallbackLocation) {
      setLocationTimeout(false)
      return
    }

    const timeoutId = setTimeout(() => {
      setLocationTimeout(true)
    }, LOCATION_TIMEOUT_MS)

    return () => clearTimeout(timeoutId)
  }, [location, usingFallbackLocation])

  // Effective location: use prop, fallback, or null
  const effectiveLocation = location || fallbackLocation

  // Handler to use default location when geolocation fails/times out
  const handleUseDefaultLocation = () => {
    setFallbackLocation(DEFAULT_LOCATION)
    setUsingFallbackLocation(true)
    setLocationTimeout(false)
    toast.success('Using London as default location')
  }

  // Handler to retry geolocation
  const handleRetryLocation = () => {
    setLocationTimeout(false)
    // Trigger page reload to retry geolocation from App.jsx
    window.location.reload()
  }

  const buildFilterKey = useCallback(
    () => buildFilterKeyPure({
      travelMode,
      showFreeOnly,
      accessibilityMode,
      showOpenOnly,
      showLocalsPicks,
      showOffPeak,
      selectedCategories,
    }),
    [travelMode, showFreeOnly, accessibilityMode, showOpenOnly, showLocalsPicks, showOffPeak, selectedCategories],
  )

  useEffect(() => {
    latestFilterKeyRef.current = buildFilterKey()
  }, [buildFilterKey])

  useEffect(() => {
    basePlacesRef.current = basePlaces
  }, [basePlaces])

  // Memoized filter function - thin closure around the pure applyDiscoverFilters
  // helper. All filter state is passed through explicitly so the helper stays
  // testable in isolation.
  const applyFilters = useCallback(
    (list, currentWeather = weather, currentFriendActivity = friendActivity) =>
      applyDiscoverFilters(list, {
        selectedCategories,
        showFreeOnly,
        accessibilityMode,
        showOpenOnly,
        showLocalsPicks,
        showOffPeak,
        isPremium,
        userProfile,
        weather: currentWeather,
        friendActivity: currentFriendActivity,
        travelMode,
        selectedBand,
      }),
    [selectedCategories, showFreeOnly, accessibilityMode, showOpenOnly, showLocalsPicks, showOffPeak, isPremium, userProfile, weather, friendActivity, travelMode, selectedBand],
  )

  // Memoized filtered places - only recalculates when basePlaces or filter deps change
  const filteredPlaces = useMemo(() => {
    if (!basePlaces || basePlaces.length === 0) return []
    return applyFilters(basePlaces, weather, friendActivity)
  }, [basePlaces, applyFilters, weather, friendActivity])

  // Memoized recommendations for Just Go - only recalculates when places change
  const justGoRecommendations = useMemo(() => {
    return getTopRecommendations(places, 5)
  }, [places])

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('roam_travel_mode', travelMode)
    localStorage.setItem('roam_free_only', showFreeOnly.toString())
    localStorage.setItem('roam_accessibility', accessibilityMode.toString())
    localStorage.setItem('roam_open_only', showOpenOnly.toString())
    localStorage.setItem('roam_interests', JSON.stringify(selectedCategories))
  }, [travelMode, showFreeOnly, accessibilityMode, showOpenOnly, selectedCategories])

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
  const loadPlaces = useCallback(async (currentWeather = null, { force = false } = {}) => {
    if (!effectiveLocation) return

    const requestId = ++latestLoadRequestRef.current
    const requestKey = buildFilterKey()
    latestFilterKeyRef.current = requestKey

    const mode = TRAVEL_MODES[travelMode]
    const resolvedWeather = currentWeather ?? weather

    // OPTIMIZATION: Check cache synchronously BEFORE setting loading state
    // If we have usable cache (fresh or stale), render it immediately without spinner.
    // EXCEPTION: when force=true (user explicitly tapped Refresh from the empty state)
    // we skip the cache entirely and hit the network — otherwise the user gets the
    // same stale data and the button feels broken.
    //
    // KNOWN LIMITATION: For tiled modes (Day Trip / Explorer, radius > 40km),
    // fetchWithTiling only writes the center tile (~35km) to the SWR cache.
    // Outer tiles arrive via fire-and-forget onProgress callbacks that don't
    // write back to the cache layer. So a fresh-cache revisit to these modes
    // renders the inner radius only, and the Long distance band can show
    // empty until the cache expires (10 min fresh / 30 min stale) or the user
    // taps Refresh. Proper fix is to instrument fetchWithTiling to write the
    // aggregated set back to cache as tiles complete — a layering refactor
    // not done in this batch.
    const cacheKey = makeCacheKey(effectiveLocation.lat, effectiveLocation.lng, mode.maxRadius, selectedCategories.length === 1 ? selectedCategories[0] : null)
    const cacheCheck = force ? { exists: false } : hasCacheSync(cacheKey)

    if (cacheCheck.exists && cacheCheck.data?.length > 0) {
      // Render cached data immediately - no loading spinner!
      const enhanced = cacheCheck.data.map(p => enhancePlace(p, effectiveLocation, { weather: resolvedWeather }))
      setBasePlaces(enhanced)
      // Only set loading for background refresh if cache is stale
      if (cacheCheck.stale) {
        // Don't set loading - just let background refresh happen silently
        setLoadError(null)
      } else {
        // Fresh cache - we're done
        setLoading(false)
        return
      }
    } else {
      // No usable cache - show loading spinner
      setLoading(true)
    }

    setLoadError(null)

    try {
      // Use SWR pattern - returns cached data immediately if available
      // For large radii, onProgress streams places as outer tiles load
      // Note: stale flag unused here since we check cache sync above
      const { data: rawPlaces } = await fetchPlacesWithSWR(
        effectiveLocation.lat,
        effectiveLocation.lng,
        mode.maxRadius,
        selectedCategories.length === 1 ? selectedCategories[0] : null,
        // Background refresh callback - full refresh from cache
        (freshPlaces) => {
          if (requestId === latestLoadRequestRef.current) {
            const enhanced = freshPlaces.map(p => enhancePlace(p, effectiveLocation, { weather: resolvedWeather }))
            setBasePlaces(enhanced)
          }
        },
        // Progressive loading callback - append new places as outer tiles complete
        (newPlaces) => {
          if (requestId === latestLoadRequestRef.current && newPlaces.length > 0) {
            const enhanced = newPlaces.map(p => enhancePlace(p, effectiveLocation, { weather: resolvedWeather }))
            setBasePlaces(prev => {
              // Dedupe by ID
              const existingIds = new Set(prev.map(p => p.id))
              const unique = enhanced.filter(p => !existingIds.has(p.id))
              if (unique.length === 0) return prev
              return [...prev, ...unique]
            })
          }
        },
        // Force flag — bypass SWR cache when the user explicitly tapped Refresh.
        { force }
      )

      // Context for smart scoring (time of day, weather)
      const scoringContext = { weather: resolvedWeather }

      // Enhance places with context
      const enhanced = rawPlaces.map(p => enhancePlace(p, effectiveLocation, scoringContext))

      if (requestId !== latestLoadRequestRef.current || requestKey !== latestFilterKeyRef.current) {
        return
      }

      // Set basePlaces - the memoized filteredPlaces and useEffect will handle the rest
      setBasePlaces(enhanced)

      // Note: stale data handling is done via sync cache check above
      // Background refresh happens automatically via fetchPlacesWithSWR callback
    } catch (error) {
      if (requestId === latestLoadRequestRef.current) {
        console.error('Failed to load places:', error)
        setBasePlaces([])
        setLoadError(error.message || 'Failed to load places')
        toast.error("Couldn't load places. Try refreshing.")
      }
    }
    if (requestId === latestLoadRequestRef.current) {
      setLoading(false)
    }
  }, [effectiveLocation, travelMode, selectedCategories, toast, buildFilterKey, weather])

  // Load more places when running low on cards
  const loadMorePlaces = useCallback(async () => {
    if (!effectiveLocation || loadingMore) return

    const filterKeyAtStart = latestFilterKeyRef.current
    setLoadingMore(true)
    const mode = TRAVEL_MODES[travelMode]

    try {
      // Expand the radius slightly to find more places
      // Premium users can explore up to 200km, free users capped at 50km
      const maxExpandedRadius = isPremium ? 200000 : 50000
      const expandedRadius = Math.min(mode.maxRadius * 1.5, maxExpandedRadius)

      const rawPlaces = await fetchEnrichedPlaces(
        effectiveLocation.lat,
        effectiveLocation.lng,
        expandedRadius,
        selectedCategories.length === 1 ? selectedCategories[0] : null
      )

      // Enhance and filter
      const enhanced = rawPlaces.map(p => enhancePlace(p, effectiveLocation, { weather }))

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
  }, [effectiveLocation, loadingMore, travelMode, selectedCategories, showFreeOnly, accessibilityMode, showOpenOnly, weather, seenPlaceIds, userProfile, isPremium])

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
    if (!effectiveLocation) return

    // Load weather once, then load places
    // Weather is loaded independently to avoid cascading fetches
    let isCancelled = false

    const load = async () => {
      const weatherKey = `${effectiveLocation.lat.toFixed(2)},${effectiveLocation.lng.toFixed(2)}`
      let currentWeather = weather

      if (weatherKeyRef.current !== weatherKey) {
        try {
          currentWeather = await fetchWeather(effectiveLocation.lat, effectiveLocation.lng)
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
  }, [effectiveLocation?.lat, effectiveLocation?.lng, travelMode])

  // Handle category changes with initial load
  // This effect ONLY runs on initial mount to load with saved categories
  // Subsequent category changes are handled by the debounced toggleCategory
  const initialCategoryLoadRef = useRef(false)
  useEffect(() => {
    if (!effectiveLocation || initialCategoryLoadRef.current) return
    if (selectedCategories.length > 0) {
      // Has saved categories from onboarding - load is already triggered by location effect
      initialCategoryLoadRef.current = true
    }
  }, [effectiveLocation, selectedCategories.length])


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
  const handleSwipe = async (action, place) => {
    if (action === 'like') {
      // CHECK SAVE LIMIT FOR FREE USERS
      const currentSaveCount = savedPlaces?.length || 0
      if (!isPremium && currentSaveCount >= 10) {
        setUpgradePromptType('saves')
        setShowUpgradePrompt(true)
        return // Don't save - show upgrade prompt instead
      }

      // Save to wishlist (hook handles localStorage vs API)
      const saveResult = await savePlace(place)
      if (!saveResult.success && !saveResult.fallback) {
        toast.error('Failed to save place. Please try again.')
      }

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

      // Plan prompt — show RARELY. Previous logic (every 3rd save OR
      // every 30s) felt constant during batch-saving. New rules:
      //   1. Show on a user's very first save ever (intro the feature)
      //   2. After that, only re-show if BOTH:
      //      - it's been >7 days since the last time we showed it
      //      - the user has saved ≥5 more places since the last show
      //   3. Once per session max — if they dismiss, they won't see it
      //      again until the next cold-launch.
      const now = Date.now()
      const totalSaves = parseInt(localStorage.getItem('roam_save_count') || '0', 10) + 1
      localStorage.setItem('roam_save_count', String(totalSaves))

      const lastShownAt = parseInt(localStorage.getItem('roam_plan_prompt_last_shown_at') || '0', 10)
      const savesAtLastShow = parseInt(localStorage.getItem('roam_plan_prompt_saves_at_last_show') || '0', 10)
      const sessionShown = lastPlanPromptRef.current > 0
      const daysSinceLastShow = (now - lastShownAt) / 86400000
      const savesSinceLastShow = totalSaves - savesAtLastShow

      const isFirstEverSave = lastShownAt === 0 && totalSaves === 1
      const isCooledDown = daysSinceLastShow >= 7 && savesSinceLastShow >= 5

      if (!sessionShown && (isFirstEverSave || isCooledDown)) {
        lastPlanPromptRef.current = now
        localStorage.setItem('roam_plan_prompt_last_shown_at', String(now))
        localStorage.setItem('roam_plan_prompt_saves_at_last_show', String(totalSaves))
        // Small delay so user sees the swipe complete
        setTimeout(() => setPlanPromptPlace(place), 400)
      }
    }

    // Track negative signals for "not interested" personalization
    if (action === 'nope') {
      // Sync to API when authenticated
      recordSwipe(place.id, 'skip')

      const notInterested = JSON.parse(localStorage.getItem('roam_not_interested') || '[]')
      const categoryKey = place.category?.key || place.categoryKey
      const placeType = place.type

      // Track the skip with timestamp (keep last 50)
      notInterested.push({
        placeId: place.id,
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

    // Sync likes to API when authenticated
    if (action === 'like') {
      recordSwipe(place.id, 'like')
    }

    // Track for analytics/stats via hook (syncs to API)
    incrementStat('totalSwipes')
    if (action === 'go') {
      // Save as pending visit for later prompt
      setPendingVisit(place)

      // Streak + activity counters via the shared helper. Reads from
      // useUserStats (server-synced) so streak data stays consistent
      // across devices. The server's stats PUT fires evaluateBadges
      // after persisting so streak_3/7/30 awards happen automatically.
      updateStats(buildWentOutPatch(stats))
    }
  }

  // Handle clicking a trending place
  // Kept exported in case Discover ever wants to surface a single
  // trending place inline; SocialHub uses the TrendingPlaces component
  // directly with navigation to /place/:id.
  // eslint-disable-next-line no-unused-vars
  const handleViewTrending = async (placeId) => {
    try {
      const place = await fetchPlaceById(placeId)
      if (place) {
        const enriched = await apiEnrichPlace(place)
        setSelectedPlace({ ...place, ...enriched })
      }
    } catch (error) {
      console.error('Failed to load trending place:', error)
      toast.error("Couldn't load place details")
    }
  }

  const currentMode = TRAVEL_MODES[travelMode]

  // Show a location-pending state when waiting for geolocation
  if (!effectiveLocation) {
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

        {locationTimeout ? (
          // Timeout state - show recovery options
          <div className="discover-error-recovery">
            <div className="discover-error-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="location">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <h3>Location taking too long</h3>
            <p>
              We couldn&apos;t get your location. You can try again or use a default location to start exploring.
            </p>
            <div className="discover-error-actions">
              <button
                className="discover-error-retry"
                onClick={handleRetryLocation}
              >
                Retry Location
              </button>
              <button
                className="discover-error-settings"
                onClick={handleUseDefaultLocation}
              >
                Use Default Location
              </button>
            </div>
          </div>
        ) : (
          // Normal pending state - still waiting for location
          <div className="discover-location-pending">
            <motion.div
              className="location-pending-icon"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="location">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </motion.div>
            <h3>Getting your location...</h3>
            <p>This helps us find places near you</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page discover-page">
      <DiscoverHeader
        streak={stats.currentStreak || 0}
        activeFiltersCount={selectedCategories.length}
        hasLocation={Boolean(effectiveLocation)}
        placesCount={places.length}
        loading={loading}
        weather={weather}
        travelMode={travelMode}
        travelModeLabel={currentMode.label}
        onOpenFilters={() => setShowFilterModal(true)}
        onTriggerJustGo={() => setShowJustGo(true)}
      />

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
        {/* Error Recovery UI — see Discover/ErrorRecovery for the error
            classification logic + action mapping. */}
        {loadError && !loading && places.length === 0 && (
          <ErrorRecovery
            loadError={loadError}
            onRetry={() => loadPlaces(weather)}
            onOpenFilters={() => setShowFilterModal(true)}
          />
        )}

        {/* Card Stack (always on mobile, conditional on desktop) */}
        {(viewMode === 'swipe' || !isDesktop) && !loadError && (
          <CardStack
            places={places}
            sponsoredPlaces={sponsoredPlaces}
            userLocation={effectiveLocation}
            onSwipe={handleSwipe}
            onExpand={(place) => setSelectedPlace(place)}
            onEmpty={() => {}}
            onRefresh={() => loadPlaces(weather, { force: true })}
            onOpenSettings={() => setShowFilterModal(true)}
            onLoadMore={loadMorePlaces}
            loading={loading}
            loadingMore={loadingMore}
            friendActivity={friendActivity}
            savesCount={savedPlaces?.length || 0}
            emptyReason={
              // Provide contextual reason for empty state
              basePlaces.length === 0 ? 'no-places' :
              selectedCategories.length > 0 || showFreeOnly || showOpenOnly || accessibilityMode ? 'filters' :
              'swiped'
            }
            activeFiltersCount={
              selectedCategories.length +
              (showFreeOnly ? 1 : 0) +
              (showOpenOnly ? 1 : 0) +
              (accessibilityMode ? 1 : 0) +
              (showLocalsPicks && isPremium ? 1 : 0) +
              (showOffPeak && isPremium ? 1 : 0)
            }
            travelMode={travelMode}
          />
        )}

        {/* Map View (desktop only) */}
        {isDesktop && viewMode === 'map' && (
          <Suspense fallback={<div className="discover-view-loading">Loading map...</div>}>
            <DiscoverMap
              places={places}
              userLocation={effectiveLocation}
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

      {/* Trending lives on the Social tab now — Discover is reserved for
          the swipe deck. The translucent swipe-card glow visually bled
          over the trending row when both shared this surface; community
          signals belong in social context anyway. */}

      {/* Place Detail Modal */}
      <AnimatePresence>
        {selectedPlace && (
          <PlaceDetail
            place={selectedPlace}
            onClose={() => setSelectedPlace(null)}
            onGo={(place) => {
              setPendingVisit(place)
              updateStats(buildWentOutPatch(stats))
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
            userLocation={effectiveLocation}
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
        selectedBand={selectedBand}
        distanceBands={getBandsFor(travelMode)}
        onBandChange={handleBandChange}
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

      {/* Just Go Modal - instant personalized recommendation */}
      <JustGoModal
        isOpen={showJustGo}
        onClose={() => setShowJustGo(false)}
        recommendations={justGoRecommendations}
        weather={weather}
        onGo={(place) => {
          setPendingVisit(place)
          incrementStat('totalSwipes')
          updateStats(buildWentOutPatch(stats, { fromJustGo: true }))
          setShowJustGo(false)
        }}
      />
    </div>
  )
}
