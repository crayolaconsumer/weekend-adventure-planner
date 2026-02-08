import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import SwipeCard from './SwipeCard'
import SponsoredCard from './SponsoredCard'
import { fetchAndCacheImage } from '../utils/imageCache'
import { fetchWikipediaImage, fetchWikidataImage, fetchOpenTripMapDetails, enrichPlace } from '../utils/apiClient'
import { useTopContributions } from '../hooks/useTopContributions'
import { useSubscription } from '../hooks/useSubscription'
import { openDirections } from '../utils/navigation'
import { getCircuitStatus } from '../utils/apiProtection'
import './CardStack.css'

// Interval for inserting sponsored cards (every N regular cards)
const SPONSORED_INTERVAL = 8

// Rotating loading messages for variety
const LOADING_MESSAGES = [
  { title: 'Discovering places', subtitle: 'Finding hidden gems near you...' },
  { title: 'Scanning the map', subtitle: 'Looking for adventures...' },
  { title: 'Exploring nearby', subtitle: 'Uncovering local treasures...' },
  { title: 'Almost there', subtitle: 'Curating the best spots...' },
]

// Compass icon component
const CompassIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill="currentColor" stroke="none" />
  </svg>
)

// Refresh icon
const RefreshIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2v6h-6"/>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
    <path d="M3 22v-6h6"/>
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
  </svg>
)

// Settings icon
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"/>
    <line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/>
    <line x1="20" y1="12" x2="20" y2="3"/>
  </svg>
)

export default function CardStack({
  places,
  sponsoredPlaces = [], // Array of { sponsored_id, place } objects
  userLocation = null, // For ad tracking
  onSwipe,
  onExpand,
  onEmpty,
  onRefresh,
  onOpenSettings,
  onLoadMore,
  loading = false,
  loadingMore = false,
  emptyReason = 'swiped', // 'swiped' | 'no-places' | 'filters' | 'error'
  activeFiltersCount = 0, // Number of active filters (for contextual messaging)
  travelMode = 'walking', // Current travel mode (for contextual messaging)
  friendActivity = {} // Map of placeId -> friend activity data
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)
  const [sponsoredCount, setSponsoredCount] = useState(0)
  const [enrichedImages, setEnrichedImages] = useState({}) // Track fetched images by place ID
  const { isPremium } = useSubscription()

  // Merge regular places with sponsored places at intervals
  // Also apply enriched images from background fetches
  const mergedPlaces = useMemo(() => {
    // Helper to apply enriched image to a place
    const applyEnrichedImage = (place) => {
      const enriched = enrichedImages[place.id]
      if (enriched && !place.photo && !place.image) {
        return { ...place, image: enriched.url, imageSource: enriched.source }
      }
      return place
    }

    if (!sponsoredPlaces || sponsoredPlaces.length === 0) {
      return places.map(p => ({ place: applyEnrichedImage(p), isSponsored: false }))
    }

    const result = []
    let sponsoredIndex = 0

    for (let i = 0; i < places.length; i++) {
      result.push({ place: applyEnrichedImage(places[i]), isSponsored: false })

      // Insert sponsored card after every SPONSORED_INTERVAL regular cards
      if ((i + 1) % SPONSORED_INTERVAL === 0 && sponsoredIndex < sponsoredPlaces.length) {
        const sponsored = sponsoredPlaces[sponsoredIndex]
        result.push({
          place: applyEnrichedImage(sponsored.place),
          isSponsored: true,
          sponsoredData: sponsored
        })
        sponsoredIndex++
      }
    }

    return result
  }, [places, sponsoredPlaces, enrichedImages])

  // Reset index when places change - legitimate pattern for syncing state to props
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setCurrentIndex(0)
  }, [places])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setLoadingMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [loading])

  // Track places we've already tried to fetch images for
  // Using ref since this doesn't need to trigger re-renders
  const fetchedImageIdsRef = useRef(new Set())

  // Fetch image for a place from various sources if it doesn't have one
  const fetchPlaceImage = useCallback(async (place) => {
    if (!place || fetchedImageIdsRef.current.has(place.id)) return null
    fetchedImageIdsRef.current.add(place.id)

    // Already has an image
    if (place.photo || place.image) return null

    try {
      // Try OpenTripMap first (has curated images)
      if (place.xid) {
        const details = await fetchOpenTripMapDetails(place.xid)
        if (details?.image) {
          setEnrichedImages(prev => ({
            ...prev,
            [place.id]: { url: details.image, source: 'opentripmap' }
          }))
          fetchAndCacheImage(details.image, place.id).catch(() => {})
          return details.image
        }
      }

      // Try Wikipedia (better quality images)
      if (place.wikipedia) {
        const title = place.wikipedia.includes(':')
          ? place.wikipedia.split(':')[1]
          : place.wikipedia
        const imageUrl = await fetchWikipediaImage(title)
        if (imageUrl) {
          setEnrichedImages(prev => ({
            ...prev,
            [place.id]: { url: imageUrl, source: 'wikipedia' }
          }))
          fetchAndCacheImage(imageUrl, place.id).catch(() => {})
          return imageUrl
        }
      }

      // Try Wikidata
      if (place.wikidata) {
        const imageUrl = await fetchWikidataImage(place.wikidata)
        if (imageUrl) {
          setEnrichedImages(prev => ({
            ...prev,
            [place.id]: { url: imageUrl, source: 'wikidata' }
          }))
          fetchAndCacheImage(imageUrl, place.id).catch(() => {})
          return imageUrl
        }
      }
    } catch (err) {
      console.warn(`[CardStack] Image fetch failed for ${place.id}:`, err.message)
    }
    return null
  }, [])

  // Preload images for visible cards FIRST, then upcoming cards
  useEffect(() => {
    if (loading || mergedPlaces.length === 0) return

    // Helper to preload a single card's image
    const preloadCard = (index) => {
      const item = mergedPlaces[index]
      const place = item?.place
      if (!place) return

      const imageUrl = place?.photo || place?.image
      if (imageUrl) {
        // Already has image - just cache it
        fetchAndCacheImage(imageUrl, place.id).catch(() => {})
      } else if (place.xid || place.wikipedia || place.wikidata) {
        // No image but has enrichment data - try to fetch one
        fetchPlaceImage(place)
      }
    }

    // CRITICAL: Preload visible cards FIRST (high priority)
    // These are the cards the user sees immediately
    for (let i = currentIndex; i < Math.min(currentIndex + 3, mergedPlaces.length); i++) {
      preloadCard(i)
    }

    // Preload upcoming cards with requestIdleCallback (low priority)
    // This prevents blocking the main thread while the visible cards load
    const preloadUpcoming = () => {
      const upcomingStart = currentIndex + 3
      const upcomingEnd = Math.min(currentIndex + 10, mergedPlaces.length)
      for (let i = upcomingStart; i < upcomingEnd; i++) {
        preloadCard(i)
      }
    }

    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      const idleId = requestIdleCallback(preloadUpcoming, { timeout: 2000 })
      return () => cancelIdleCallback(idleId)
    } else {
      const timeoutId = setTimeout(preloadUpcoming, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [currentIndex, mergedPlaces, loading, fetchPlaceImage])

  // Debug: Check circuit breaker state on mount
  useEffect(() => {
    const otmStatus = getCircuitStatus('opentripmap')
    if (otmStatus.state !== 'closed') {
      console.warn(`[CardStack] OpenTripMap circuit breaker is ${otmStatus.state.toUpperCase()} - images may be disabled. Failures: ${otmStatus.failures}`)
    }
  }, [])

  // Track places we've already tried to prefetch details for
  // Using ref since this doesn't need to trigger re-renders
  const prefetchedDetailIdsRef = useRef(new Set())

  // Background detail enrichment - prefetch for visible cards and a few upcoming
  // This makes PlaceDetail load instantly when user taps a card
  useEffect(() => {
    if (loading || mergedPlaces.length === 0) return

    const prefetchDetails = async (index) => {
      const item = mergedPlaces[index]
      const place = item?.place
      if (!place || prefetchedDetailIdsRef.current.has(place.id)) return

      prefetchedDetailIdsRef.current.add(place.id)

      try {
        // enrichPlace has internal caching, so this just warms the cache
        await enrichPlace(place)
      } catch {
        // Silently ignore prefetch errors
      }
    }

    // Prefetch visible cards (high priority) - immediate
    for (let i = currentIndex; i < Math.min(currentIndex + 3, mergedPlaces.length); i++) {
      prefetchDetails(i)
    }

    // Prefetch upcoming cards (low priority) - with idle callback
    const prefetchUpcoming = () => {
      for (let i = currentIndex + 3; i < Math.min(currentIndex + 6, mergedPlaces.length); i++) {
        prefetchDetails(i)
      }
    }

    if (typeof requestIdleCallback !== 'undefined') {
      const idleId = requestIdleCallback(prefetchUpcoming, { timeout: 3000 })
      return () => cancelIdleCallback(idleId)
    } else {
      const timeoutId = setTimeout(prefetchUpcoming, 200)
      return () => clearTimeout(timeoutId)
    }
  }, [currentIndex, mergedPlaces, loading])

  // Load more places when getting close to the end (10 cards left)
  // Increased from 5 to reduce perceived loading lag
  useEffect(() => {
    if (loading || loadingMore || !onLoadMore) return

    const remainingCards = mergedPlaces.length - currentIndex
    if (remainingCards <= 10 && remainingCards > 0) {
      onLoadMore()
    }
  }, [currentIndex, mergedPlaces.length, loading, loadingMore, onLoadMore])

  const handleSwipe = (action) => {
    const currentItem = mergedPlaces[currentIndex]
    const place = currentItem?.place

    // Track sponsored card views for premium hint
    if (currentItem?.isSponsored) {
      setSponsoredCount(prev => prev + 1)
    }

    // Open directions SYNCHRONOUSLY for "go" action to avoid popup blockers
    // This must happen before any async operations or timeouts
    if (action === 'go' && place) {
      openDirections(place.lat, place.lng, place.name)
    }

    // Notify parent (pass the place, not the wrapper object)
    // Don't track sponsored cards in the main save flow (handled by SponsoredCard)
    if (!currentItem?.isSponsored) {
      onSwipe?.(action, place)
    }

    // Move to next card
    setTimeout(() => {
      setCurrentIndex(prev => {
        const next = prev + 1
        if (next >= mergedPlaces.length) {
          onEmpty?.()
        }
        return next
      })
    }, 100)
  }

  // Get visible cards (current + 2 behind)
  const visibleCards = mergedPlaces.slice(currentIndex, currentIndex + 3)
  const prefetchCards = mergedPlaces.slice(currentIndex, currentIndex + 12)
  const prefetchPlaceIds = prefetchCards.map(item => item.place?.id).filter(Boolean)
  const { contributions: topContributions } = useTopContributions(prefetchPlaceIds)

  const currentMessage = LOADING_MESSAGES[loadingMessageIndex]

  if (loading) {
    return (
      <div className="card-stack">
        <div className="card-stack-loading">
          <motion.div
            className="card-stack-loading-icon"
            animate={{ rotate: [0, 45, -30, 15, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <CompassIcon />
          </motion.div>
          <div className="card-stack-loading-cards">
            <motion.div
              className="loading-card"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="loading-card"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
            />
            <motion.div
              className="loading-card"
              animate={{ y: [0, -2, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
            />
          </div>
          <div className="card-stack-loading-text">
            <AnimatePresence mode="wait">
              <motion.div
                key={loadingMessageIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
              >
                <h4>{currentMessage.title}</h4>
                <p>{currentMessage.subtitle}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    )
  }

  // Determine empty state type
  const isSwipedThrough = mergedPlaces.length > 0 && currentIndex >= mergedPlaces.length
  const hasNoPlaces = mergedPlaces.length === 0

  // Show loading state when fetching more cards
  if (loadingMore && isSwipedThrough) {
    return (
      <div className="card-stack">
        <div className="card-stack-loading">
          <motion.div
            className="card-stack-loading-icon"
            animate={{ rotate: [0, 45, -30, 15, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <CompassIcon />
          </motion.div>
          <div className="card-stack-loading-text">
            <h4>Finding more places</h4>
            <p>Discovering new adventures...</p>
          </div>
        </div>
      </div>
    )
  }

  if (hasNoPlaces || isSwipedThrough) {
    // Build contextual empty state based on reason
    let emptyConfig

    if (isSwipedThrough) {
      // User swiped through all cards
      emptyConfig = {
        icon: '🎉',
        title: 'All caught up!',
        subtitle: activeFiltersCount > 0
          ? `You've seen all ${activeFiltersCount} filtered result${activeFiltersCount !== 1 ? 's' : ''}. Try removing some filters or expanding your search.`
          : "You've explored all nearby places. Try expanding your travel radius or adjusting filters.",
        primaryAction: onRefresh ? { label: 'Discover More', icon: <RefreshIcon />, action: onRefresh } : null,
        secondaryAction: onOpenSettings ? { label: 'Adjust Filters', icon: <SettingsIcon />, action: onOpenSettings } : null
      }
    } else if (emptyReason === 'filters') {
      // Filters are too restrictive
      emptyConfig = {
        title: 'No matches found',
        subtitle: activeFiltersCount > 0
          ? `Your ${activeFiltersCount} active filter${activeFiltersCount !== 1 ? 's are' : ' is'} too restrictive for this area. Try removing some filters to see more places.`
          : "Try adjusting your filters to see more places.",
        primaryAction: onOpenSettings ? { label: 'Adjust Filters', icon: <SettingsIcon />, action: onOpenSettings } : null,
        secondaryAction: onRefresh ? { label: 'Refresh', icon: <RefreshIcon />, action: onRefresh } : null
      }
    } else if (emptyReason === 'error') {
      emptyConfig = {
        icon: '😕',
        title: 'Something went wrong',
        subtitle: "We couldn't load places right now. Check your connection and try again.",
        primaryAction: onRefresh ? { label: 'Try Again', icon: <RefreshIcon />, action: onRefresh } : null,
        secondaryAction: null
      }
    } else {
      // No places in area (no-places)
      const radiusHint = travelMode === 'walking' ? 'Try switching to driving mode for a wider search area.' :
                         travelMode === 'driving' ? 'This area seems quiet. Try a different location.' :
                         'Try expanding your travel radius or exploring a different location.'
      emptyConfig = {
        icon: '🗺️',
        title: 'No places nearby',
        subtitle: `We couldn't find adventures in this area. ${radiusHint}`,
        primaryAction: onOpenSettings ? { label: 'Expand Radius', icon: <SettingsIcon />, action: onOpenSettings } : null,
        secondaryAction: onRefresh ? { label: 'Refresh', icon: <RefreshIcon />, action: onRefresh } : null
      }
    }

    return (
      <div className="card-stack">
        <motion.div
          className="card-stack-empty"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="card-stack-empty-illustration"
            style={{ fontSize: 72 }}
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            {emptyConfig.icon}
          </motion.div>
          <h3>{emptyConfig.title}</h3>
          <p>{emptyConfig.subtitle}</p>
          <div className="card-stack-empty-action">
            {emptyConfig.primaryAction && (
              <motion.button
                className="card-stack-empty-btn"
                onClick={emptyConfig.primaryAction.action}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {emptyConfig.primaryAction.icon}
                {emptyConfig.primaryAction.label}
              </motion.button>
            )}
            {emptyConfig.secondaryAction && (
              <motion.button
                className="card-stack-empty-btn secondary"
                onClick={emptyConfig.secondaryAction.action}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {emptyConfig.secondaryAction.icon}
                {emptyConfig.secondaryAction.label}
              </motion.button>
            )}
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="card-stack">
      <div className="card-stack-wrapper">
        <AnimatePresence>
          {visibleCards.map((item, index) => {
            const { place, isSponsored, sponsoredData } = item
            const isTop = index === 0
            const scale = 1 - (index * 0.04)
            const yOffset = index * 8

            // Create unique key for sponsored vs regular cards
            const cardKey = isSponsored
              ? `sponsored-${sponsoredData?.sponsored_id || place.id}`
              : place.id

            return (
              <motion.div
                key={cardKey}
                className="card-stack-item"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{
                  scale,
                  y: yOffset,
                  opacity: 1,
                  zIndex: visibleCards.length - index
                }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.2 }
                }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 30
                }}
                style={{
                  position: 'absolute',
                  width: '100%'
                }}
              >
                {isSponsored ? (
                  <SponsoredCard
                    sponsoredPlace={sponsoredData}
                    place={place}
                    onSwipe={isTop ? handleSwipe : undefined}
                    onExpand={isTop ? onExpand : undefined}
                    isTop={isTop}
                    userLocation={userLocation}
                    topContribution={topContributions?.[place.id] || null}
                  />
                ) : (
                  <SwipeCard
                    place={place}
                    onSwipe={isTop ? handleSwipe : undefined}
                    onExpand={isTop ? onExpand : undefined}
                    isTop={isTop}
                    topContribution={topContributions?.[place.id] || null}
                    friendActivity={friendActivity?.[place.id] || null}
                  />
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Progress indicator */}
      <div className="card-stack-progress">
        <div className="card-stack-progress-bar">
          <motion.div
            className="card-stack-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${((currentIndex + 1) / mergedPlaces.length) * 100}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
        <span className="card-stack-count">
          {currentIndex + 1} of {mergedPlaces.length}
        </span>
      </div>

      {/* Premium hint after sponsored cards */}
      {!isPremium && sponsoredCount > 0 && sponsoredCount % 3 === 0 && (
        <motion.div
          className="card-stack-premium-hint"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Link to="/pricing">Go ad-free with ROAM+ →</Link>
        </motion.div>
      )}
    </div>
  )
}
