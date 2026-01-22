import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { fetchEnrichedPlaces } from '../utils/apiClient'
import { filterPlaces, enhancePlace, getRandomQualityPlaces } from '../utils/placeFilter'
import { useToast } from '../hooks/useToast'
import './Plan.css'

const VIBES = [
  { key: 'mixed', label: 'Mix It Up', icon: '🎲', categories: null },
  { key: 'foodie', label: 'Food Crawl', icon: '🍽️', categories: ['food', 'nightlife'] },
  { key: 'culture', label: 'Culture Day', icon: '🎭', categories: ['culture', 'historic'] },
  { key: 'nature', label: 'Outdoor Adventure', icon: '🌿', categories: ['nature', 'active'] },
  { key: 'chill', label: 'Chill Vibes', icon: '☕', categories: ['food', 'unique'] },
]

const DURATIONS = [
  { hours: 2, label: '2 hours', stops: 2 },
  { hours: 4, label: 'Half day', stops: 3 },
  { hours: 6, label: 'Full day', stops: 4 },
  { hours: 8, label: 'Epic day', stops: 5 },
]

// Travel mode configurations (synced with Discover page settings)
const TRAVEL_MODES = {
  walking: { label: 'Walking', icon: '🚶', speed: 5, maxTime: 30 },
  driving: { label: 'Driving', icon: '🚗', speed: 40, maxTime: 30 },
  transit: { label: 'Transit', icon: '🚌', speed: 20, maxTime: 45 }
}

// Food-related categories that shouldn't be consecutive
const FOOD_CATEGORIES = ['food', 'nightlife']

// Icons
const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const ShuffleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16,3 21,3 21,8"/>
    <line x1="4" y1="20" x2="21" y2="3"/>
    <polyline points="21,16 21,21 16,21"/>
    <line x1="15" y1="15" x2="21" y2="21"/>
    <line x1="4" y1="4" x2="9" y2="9"/>
  </svg>
)

const SaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19,21H5a2,2,0,0,1-2-2V5A2,2,0,0,1,5,3H16l5,5V19A2,2,0,0,1,19,21Z"/>
    <polyline points="17,21 17,13 7,13 7,21"/>
    <polyline points="7,3 7,8 15,8"/>
  </svg>
)

const MapPinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

// Loading messages for variety
const LOADING_MESSAGES = [
  { title: 'Planning your adventure', subtitle: 'Finding the best spots...' },
  { title: 'Building your route', subtitle: 'Optimizing for fun...' },
  { title: 'Curating experiences', subtitle: 'Selecting hidden gems...' },
]

export default function Plan({ location }) {
  const toast = useToast()
  const [selectedVibe, setSelectedVibe] = useState('mixed')
  const [selectedDuration, setSelectedDuration] = useState(4)
  const [adventure, setAdventure] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)
  const [savedAdventures, setSavedAdventures] = useState(() => {
    const saved = localStorage.getItem('roam_adventures')
    return saved ? JSON.parse(saved) : []
  })
  const [availablePlaces, setAvailablePlaces] = useState([]) // Pool for shuffleStop
  const [travelMode] = useState(() => {
    return localStorage.getItem('roam_travel_mode') || 'walking'
  })

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setLoadingMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [loading])

  const buildAdventure = async () => {
    if (!location) return

    setLoading(true)
    setLoadingMessageIndex(0)

    const vibe = VIBES.find(v => v.key === selectedVibe)
    const duration = DURATIONS.find(d => d.hours === selectedDuration)

    try {
      const rawPlaces = await fetchEnrichedPlaces(
        location.lat,
        location.lng,
        10000, // 10km radius for more options
        null
      )

      const enhanced = rawPlaces.map(p => enhancePlace(p, location))
      const filtered = filterPlaces(enhanced, {
        categories: vibe.categories,
        minScore: 45,
        maxResults: 50
      })

      // Store filtered places for shuffle functionality
      setAvailablePlaces(filtered)

      // Get random quality places for the adventure
      const stops = getRandomQualityPlaces(filtered, duration.stops, { minScore: 45 })

      // Optimize route (simple nearest-neighbor)
      const optimized = optimizeRoute(stops, location)

      // Enforce diversity - space out food/restaurant stops
      const diverse = enforceDiversity(optimized)

      // Calculate times
      const startTime = new Date()
      startTime.setHours(10, 0, 0, 0) // Default 10am start

      const stopsWithTimes = diverse.map((stop, index) => {
        const time = new Date(startTime)
        time.setMinutes(time.getMinutes() + (index * 90)) // 90 mins per stop

        return {
          ...stop,
          scheduledTime: time.toISOString(),
          duration: 60 // 60 mins at each stop
        }
      })

      /* eslint-disable react-hooks/purity */
      setAdventure({
        id: Date.now(),
        vibe: vibe.key,
        vibeName: vibe.label,
        vibeIcon: vibe.icon,
        totalHours: duration.hours,
        stops: stopsWithTimes,
        createdAt: new Date().toISOString()
      })
      /* eslint-enable react-hooks/purity */

    } catch (error) {
      console.error('Failed to build adventure:', error)
      toast.error("Couldn't build adventure. Please try again.")
    }

    setLoading(false)
  }

  // Simple nearest-neighbor route optimization
  const optimizeRoute = (places, start) => {
    if (places.length <= 1) return places

    const optimized = []
    const remaining = [...places]
    let current = start

    while (remaining.length > 0) {
      let nearestIndex = 0
      let nearestDist = Infinity

      remaining.forEach((place, index) => {
        const dist = calculateDistance(current.lat, current.lng, place.lat, place.lng)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestIndex = index
        }
      })

      const nearest = remaining.splice(nearestIndex, 1)[0]
      optimized.push(nearest)
      current = nearest
    }

    return optimized
  }

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  // Enforce diversity - space out food/restaurant stops so they're not consecutive
  const enforceDiversity = (places) => {
    if (places.length <= 2) return places

    const result = [...places]
    const isFood = (place) => FOOD_CATEGORIES.includes(place.category?.key)

    // Multiple passes to fix consecutive food places
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < result.length - 1; i++) {
        if (isFood(result[i]) && isFood(result[i + 1])) {
          // Find a non-food place to swap with
          for (let j = i + 2; j < result.length; j++) {
            if (!isFood(result[j])) {
              // Swap positions
              const temp = result[i + 1]
              result[i + 1] = result[j]
              result[j] = temp
              break
            }
          }
        }
      }
    }

    return result
  }

  const shuffleStop = (index) => {
    if (!adventure || !availablePlaces.length) return

    const currentStop = adventure.stops[index]
    const currentStopIds = adventure.stops.map(s => s.id)

    // Find replacement candidates (not already in adventure, prefer same category)
    const candidates = availablePlaces.filter(p => !currentStopIds.includes(p.id))
    if (candidates.length === 0) return

    // Prefer same category, fall back to any
    const sameCategoryCandidates = candidates.filter(
      p => p.category?.key === currentStop.category?.key
    )
    const pool = sameCategoryCandidates.length > 0 ? sameCategoryCandidates : candidates

    // Pick a random replacement
    // eslint-disable-next-line react-hooks/purity -- This is an event handler, not render
    const replacement = pool[Math.floor(Math.random() * pool.length)]

    // Create new stops array with replacement
    const newStops = [...adventure.stops]
    newStops[index] = {
      ...replacement,
      scheduledTime: currentStop.scheduledTime,
      duration: currentStop.duration
    }

    // Apply diversity check after swap
    const diverse = enforceDiversity(newStops)

    // Update adventure
    setAdventure({
      ...adventure,
      stops: diverse
    })
  }

  const saveAdventure = () => {
    if (!adventure) return

    const newSaved = [adventure, ...savedAdventures].slice(0, 10)
    setSavedAdventures(newSaved)
    localStorage.setItem('roam_adventures', JSON.stringify(newSaved))

    // Update stats for profile
    const stats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
    stats.adventuresCreated = (stats.adventuresCreated || 0) + 1
    stats.lastActivityDate = new Date().toISOString()
    localStorage.setItem('roam_stats', JSON.stringify(stats))
  }

  const formatTime = (isoString) => {
    return new Date(isoString).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getTravelTime = (from, to) => {
    if (!from || !to) return null
    const dist = calculateDistance(from.lat, from.lng, to.lat, to.lng)
    const mode = TRAVEL_MODES[travelMode] || TRAVEL_MODES.walking
    const minutes = Math.round((dist / mode.speed) * 60)
    return minutes
  }

  // Format travel time with cap for display
  const formatTravelTime = (from, to) => {
    const minutes = getTravelTime(from, to)
    if (minutes === null) return null

    const mode = TRAVEL_MODES[travelMode] || TRAVEL_MODES.walking
    const modeLabel = travelMode === 'walking' ? 'walk' : travelMode === 'driving' ? 'drive' : 'transit'

    if (minutes > mode.maxTime) {
      return `${mode.maxTime}+ min ${modeLabel}`
    }
    return `${minutes} min ${modeLabel}`
  }

  return (
    <div className="page plan-page">
      <header className="page-header">
        <h1 className="page-title">Plan an Adventure</h1>
      </header>

      <div className="page-content">
        {!adventure ? (
          <motion.div
            className="plan-builder"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Vibe Selection */}
            <div className="plan-section">
              <h3 className="plan-section-title">What's the vibe?</h3>
              <div className="plan-vibes">
                {VIBES.map(vibe => (
                  <button
                    key={vibe.key}
                    className={`plan-vibe ${selectedVibe === vibe.key ? 'selected' : ''}`}
                    onClick={() => setSelectedVibe(vibe.key)}
                  >
                    <span className="plan-vibe-icon">{vibe.icon}</span>
                    <span className="plan-vibe-label">{vibe.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Duration Selection */}
            <div className="plan-section">
              <h3 className="plan-section-title">How much time do you have?</h3>
              <div className="plan-durations">
                {DURATIONS.map(duration => (
                  <button
                    key={duration.hours}
                    className={`plan-duration ${selectedDuration === duration.hours ? 'selected' : ''}`}
                    onClick={() => setSelectedDuration(duration.hours)}
                  >
                    <span className="plan-duration-label">{duration.label}</span>
                    <span className="plan-duration-stops">{duration.stops} stops</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Build Button */}
            <button
              className="plan-build-btn"
              onClick={buildAdventure}
              disabled={!location || loading}
            >
              {loading ? (
                <div className="plan-loading">
                  <div className="plan-loading-spinner" />
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={loadingMessageIndex}
                      className="plan-loading-text"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="plan-loading-title">{LOADING_MESSAGES[loadingMessageIndex].title}</span>
                      <span className="plan-loading-subtitle">{LOADING_MESSAGES[loadingMessageIndex].subtitle}</span>
                    </motion.div>
                  </AnimatePresence>
                </div>
              ) : (
                'Build My Adventure'
              )}
            </button>

            {/* Hint for saved adventures below */}
            {savedAdventures.length > 0 && (
              <p className="plan-saved-hint">
                or view {savedAdventures.length} saved adventure{savedAdventures.length > 1 ? 's' : ''} below
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            className="plan-result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Adventure Header */}
            <div className="adventure-header">
              <span className="adventure-vibe">
                {adventure.vibeIcon} {adventure.vibeName}
              </span>
              <h2 className="adventure-title">Your {adventure.totalHours}-Hour Adventure</h2>
            </div>

            {/* Timeline */}
            <div className="adventure-timeline">
              {adventure.stops.map((stop, index) => (
                <div key={stop.id} className="timeline-item">
                  <div className="timeline-marker" />

                  <div className="timeline-time">
                    {formatTime(stop.scheduledTime)}
                  </div>

                  <div className="timeline-card">
                    <div className="timeline-card-header">
                      {stop.category && (
                        <span className="timeline-category">
                          {stop.category.icon}
                        </span>
                      )}
                      <h4 className="timeline-place-name">{stop.name}</h4>
                    </div>

                    <div className="timeline-place-meta">
                      {stop.distance && (
                        <span>
                          <MapPinIcon />
                          {stop.distance < 1 ? `${Math.round(stop.distance * 1000)}m` : `${stop.distance.toFixed(1)}km`}
                        </span>
                      )}
                      {stop.type && (
                        <span className="timeline-type">
                          {stop.type.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>

                    <button
                      className="timeline-shuffle"
                      onClick={() => shuffleStop(index)}
                      title="Swap this stop"
                    >
                      <ShuffleIcon />
                    </button>
                  </div>

                  {/* Travel time to next stop */}
                  {index < adventure.stops.length - 1 && (
                    <div className="timeline-travel">
                      <span>↓</span>
                      <span>{formatTravelTime(stop, adventure.stops[index + 1])}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="adventure-actions">
              <button className="btn btn-primary" onClick={saveAdventure}>
                <SaveIcon />
                Save Adventure
              </button>
              <button className="btn btn-ghost" onClick={() => setAdventure(null)}>
                Start Over
              </button>
            </div>
          </motion.div>
        )}

        {/* Recent Adventures */}
        {!adventure && (
          <div className="plan-recent">
            <h3 className="plan-section-title">Recent Adventures</h3>
            {savedAdventures.length > 0 ? (
              <div className="plan-recent-list">
                {savedAdventures.slice(0, 3).map(adv => (
                  <button
                    key={adv.id}
                    className="plan-recent-item"
                    onClick={() => setAdventure(adv)}
                  >
                    <span className="plan-recent-icon">{adv.vibeIcon}</span>
                    <div className="plan-recent-info">
                      <span className="plan-recent-title">{adv.vibeName}</span>
                      <span className="plan-recent-meta">
                        {adv.stops.length} stops · {adv.totalHours}h
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="plan-empty-state">
                <div className="plan-empty-icon">🗺️</div>
                <p className="plan-empty-text">No adventures yet</p>
                <p className="plan-empty-hint">Build your first adventure above!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
