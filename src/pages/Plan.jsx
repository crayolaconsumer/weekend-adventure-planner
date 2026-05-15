/**
 * Plan Page - Adventure Builder
 *
 * UNIFIED VIEW matching the exact spec:
 * - VIBE: [chips] inline
 * - DURATION: [chips] inline
 * - FROM YOUR WISHLIST section with drag indicators
 * - YOUR ITINERARY with Share/Save buttons
 * - Timeline with time column, drag handles, travel times
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { fetchEnrichedPlaces } from '../utils/apiClient'
import { filterPlaces, enhancePlace } from '../utils/placeFilter'
import { useToast } from '../hooks/useToast'
import { useRouting } from '../hooks/useRouting'
import { useSavedPlaces } from '../hooks/useSavedPlaces'
import { useFormatDistance } from '../contexts/DistanceContext'
import ShareModal from '../components/plan/ShareModal'
import FilterIcon from '../components/icons/FilterIcon'
import VibeIcon from '../components/icons/VibeIcon'
import { VIBES, DURATIONS, TRANSPORT_MODES, RADIUS_OPTIONS } from './Plan/constants'
import {
  DragIcon,
  ShuffleIcon,
  CloseIcon,
  ShareIcon,
  SaveIcon,
  PlusIcon,
  ChevronIcon,
  SettingsIcon,
} from './Plan/icons'
import { selectDiverseStops } from './Plan/selectDiverseStops'
import { getAuthToken } from './Plan/utils'
import './Plan.css'

export default function Plan({ location }) {
  const toast = useToast()
  const navigate = useNavigate()
  const { getTravelTime: fetchTravelTime } = useRouting()
  const { places: wishlist } = useSavedPlaces()
  const formatDistance = useFormatDistance()

  // State
  const [selectedVibe, setSelectedVibe] = useState('mixed')
  const [selectedDuration, setSelectedDuration] = useState(4)
  const [selectedTransport, setSelectedTransport] = useState('walk')
  const [selectedRadius, setSelectedRadius] = useState('local')
  const [itinerary, setItinerary] = useState([])
  const [travelTimes, setTravelTimes] = useState({}) // Cache of travel times: { "stopId-nextStopId": { duration, mode } }
  const [editingLegIndex, setEditingLegIndex] = useState(null) // Which leg's mode is being edited
  const [editingTimeIndex, setEditingTimeIndex] = useState(null) // Which stop's time is being edited
  const [availablePlaces, setAvailablePlaces] = useState([])
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareCode, setShareCode] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [initialSettings, setInitialSettings] = useState(null) // Track settings when sheet opens

  // Check for pending places from Discover
  useEffect(() => {
    const pending = localStorage.getItem('roam_pending_plan_place')
    if (pending) {
      const places = JSON.parse(pending)
      if (places.length > 0) {
        toast.info(`${places[0].name} ready to add!`)
        localStorage.removeItem('roam_pending_plan_place')
      }
    }
  }, [toast])

  // Calculate distance
  const calcDist = useCallback((lat1, lon1, lat2, lon2) => {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }, [])

  // Optimize route
  const optimizeRoute = useCallback((places, start) => {
    if (places.length <= 1) return places
    const result = []
    const remaining = [...places]
    let current = start
    while (remaining.length) {
      let best = 0, bestDist = Infinity
      remaining.forEach((p, i) => {
        const d = calcDist(current.lat, current.lng, p.lat, p.lng)
        if (d < bestDist) { bestDist = d; best = i }
      })
      const nearest = remaining.splice(best, 1)[0]
      result.push(nearest)
      current = nearest
    }
    return result
  }, [calcDist])

  // Generate itinerary with timeout handling and retry
  const generate = async (retryCount = 0) => {
    if (!location) { toast.error('Need location'); return }
    if (isGenerating && retryCount === 0) return

    setIsGenerating(true)
    const vibe = VIBES.find(v => v.key === selectedVibe)
    const duration = DURATIONS.find(d => d.hours === selectedDuration)
    const radiusConfig = RADIUS_OPTIONS.find(r => r.key === selectedRadius)

    // Create a timeout promise - 45 seconds for first try, 60 for retry
    const timeoutMs = retryCount > 0 ? 60000 : 45000
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    )

    try {
      // Show progress
      if (retryCount === 0) {
        toast.info('Finding places near you...')
      } else {
        toast.info('Retrying with extended search...')
      }

      // Fetch with timeout
      const raw = await Promise.race([
        fetchEnrichedPlaces(location.lat, location.lng, radiusConfig.radius, null),
        timeoutPromise
      ])

      // If no API places found, fallback to wishlist
      if (raw.length === 0 && wishlist.length > 0) {
        toast.info('No places found in this area - using your saved places instead')
        const wishlistStops = wishlist
          .filter(w => w.lat && w.lng)
          .slice(0, duration.stops)
          .map((place, i) => {
            const startTime = new Date()
            startTime.setHours(10, 0, 0, 0)
            const time = new Date(startTime)
            time.setMinutes(time.getMinutes() + i * 150)
            return {
              ...place,
              scheduledTime: time.toISOString(),
              duration: 90,
              distance: calcDist(location.lat, location.lng, place.lat, place.lng)
            }
          })

        if (wishlistStops.length > 0) {
          setItinerary(wishlistStops)
          toast.success(`${wishlistStops.length} stops from your wishlist!`)
        } else {
          toast.info('No places found. Try saving some places first!')
        }
        setIsGenerating(false)
        return
      }

      const enhanced = raw.map(p => enhancePlace(p, location))

      // Filter places - vibe categories applied as BOOST (not hard filter)
      // Places matching vibe rank higher, but variety is preserved
      const filtered = filterPlaces(enhanced, {
        categories: vibe.categories,
        minScore: 20,
        maxResults: 50,
        ensureDiversity: true
      })
      setAvailablePlaces(filtered)

      // Select stops with category diversity (strict for mixed mode)
      const isMixed = selectedVibe === 'mixed'
      const stops = selectDiverseStops(filtered, duration.stops, isMixed)

      const optimized = optimizeRoute(stops, location)

      const startTime = new Date()
      startTime.setHours(10, 0, 0, 0)

      const withTimes = optimized.map((stop, i) => {
        const time = new Date(startTime)
        // 2.5 hours per stop (150 min) - enough time to travel + actually enjoy the place
        time.setMinutes(time.getMinutes() + i * 150)
        return {
          ...stop,
          scheduledTime: time.toISOString(),
          duration: 90, // 1.5 hours at each place by default
          distance: calcDist(location.lat, location.lng, stop.lat, stop.lng)
        }
      })

      setItinerary(withTimes)

      // Show actual count, not expected count
      if (withTimes.length > 0) {
        toast.success(`${withTimes.length} stops added!`)
      } else {
        toast.info('No places found nearby. Try a different location.')
      }
    } catch (e) {
      console.error('[Plan] Generate error:', e)
      if (e.message === 'timeout') {
        // Retry once on timeout
        if (retryCount < 1) {
          toast.info('Still searching...')
          return generate(retryCount + 1)
        }
        // If still timing out, use wishlist as fallback
        if (wishlist.length > 0) {
          toast.info('Search timed out - using your saved places instead')
          const wishlistStops = wishlist
            .filter(w => w.lat && w.lng)
            .slice(0, duration.stops)
            .map((place, i) => {
              const startTime = new Date()
              startTime.setHours(10, 0, 0, 0)
              const time = new Date(startTime)
              time.setMinutes(time.getMinutes() + i * 150)
              return {
                ...place,
                scheduledTime: time.toISOString(),
                duration: 90,
                distance: calcDist(location.lat, location.lng, place.lat, place.lng)
              }
            })
          if (wishlistStops.length > 0) {
            setItinerary(wishlistStops)
            toast.success(`${wishlistStops.length} stops from your wishlist!`)
          } else {
            toast.error('Search timed out. Try adding places manually.')
          }
        } else {
          toast.error('Search timed out. Try adding places manually.')
        }
      } else {
        toast.error('Failed to generate. Please try again.')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  // Add from wishlist
  const addStop = useCallback((place) => {
    if (itinerary.some(s => s.id === place.id)) {
      toast.info('Already added')
      return
    }

    const last = itinerary[itinerary.length - 1]
    let time = new Date()
    if (last) {
      time = new Date(last.scheduledTime)
      time.setMinutes(time.getMinutes() + 150) // 2.5 hours after previous stop
    } else {
      time.setHours(10, 0, 0, 0)
    }

    setItinerary(prev => [...prev, {
      ...place,
      scheduledTime: time.toISOString(),
      duration: 90, // 1.5 hours at the place
      distance: location ? calcDist(location.lat, location.lng, place.lat, place.lng) : null
    }])
    toast.success(`Added ${place.name}`)
  }, [itinerary, location, calcDist, toast])

  // Remove stop
  const removeStop = useCallback((index) => {
    setItinerary(prev => {
      const next = prev.filter((_, i) => i !== index)
      if (!next.length) return next
      const start = new Date(prev[0].scheduledTime)
      return next.map((s, i) => {
        const t = new Date(start)
        t.setMinutes(t.getMinutes() + i * 150)
        return { ...s, scheduledTime: t.toISOString() }
      })
    })
  }, [])

  // Shuffle stop
  const shuffleStop = useCallback((index) => {
    if (!availablePlaces.length) { toast.info('Generate first'); return }
    const current = itinerary[index]
    const usedIds = itinerary.map(s => s.id)
    const candidates = availablePlaces.filter(p => !usedIds.includes(p.id))
    if (!candidates.length) {
      // Explain why there are no alternatives
      if (availablePlaces.length <= itinerary.length) {
        toast.info('All available places are already in your itinerary. Try a wider search radius.')
      } else {
        toast.info('No alternatives match your current filters. Try changing the vibe.')
      }
      return
    }

    const sameCategory = candidates.filter(p => p.category?.key === current.category?.key)
    const pool = sameCategory.length ? sameCategory : candidates
    const replacement = pool[Math.floor(Math.random() * pool.length)]

    setItinerary(prev => prev.map((s, i) => i === index ? {
      ...replacement,
      scheduledTime: s.scheduledTime,
      duration: s.duration,
      distance: location ? calcDist(location.lat, location.lng, replacement.lat, replacement.lng) : null
    } : s))
  }, [itinerary, availablePlaces, location, calcDist, toast])

  // Reorder
  const handleReorder = useCallback((newOrder) => {
    if (!newOrder.length) return
    const start = new Date(itinerary[0].scheduledTime)
    setItinerary(newOrder.map((s, i) => {
      const t = new Date(start)
      t.setMinutes(t.getMinutes() + i * 150)
      return { ...s, scheduledTime: t.toISOString() }
    }))
  }, [itinerary])

  // Update a stop's scheduled time
  const updateStopTime = useCallback((index, newTime) => {
    setItinerary(prev => prev.map((s, i) => {
      if (i !== index) return s
      const date = new Date(s.scheduledTime)
      const [hours, minutes] = newTime.split(':').map(Number)
      date.setHours(hours, minutes, 0, 0)
      return { ...s, scheduledTime: date.toISOString() }
    }))
    setEditingTimeIndex(null)
  }, [])

  // Save to database
  const save = useCallback(async () => {
    if (!itinerary.length) { toast.info('Add stops first'); return }
    if (isSaving) return

    setIsSaving(true)
    try {
      const vibeName = VIBES.find(v => v.key === selectedVibe)?.label || 'Mix'
      const payload = {
        title: `${vibeName} Adventure`,
        vibe: selectedVibe,
        durationHours: selectedDuration,
        defaultTransport: selectedTransport,
        isPublic: true,
        stops: itinerary.map((stop, idx) => {
          const nextStop = itinerary[idx + 1]
          const legKey = nextStop ? getLegKey(stop, nextStop) : null
          const travelInfo = legKey ? travelTimes[legKey] : null

          return {
            placeId: stop.id,
            placeData: {
              id: stop.id,
              name: stop.name,
              type: stop.type,
              lat: stop.lat,
              lng: stop.lng,
              address: stop.address,
              category: stop.category
            },
            scheduledTime: stop.scheduledTime,
            durationMinutes: stop.duration || 60,
            transportToNext: stop.transportToNext || selectedTransport,
            travelTimeToNext: travelInfo?.duration || null
          }
        })
      }

      const token = getAuthToken()
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        const data = await res.json()
        setShareCode(data.plan.shareCode)
        toast.success('Saved! Ready to share.')
      } else if (res.status === 401) {
        // Save to localStorage as fallback for non-authenticated users
        const saved = JSON.parse(localStorage.getItem('roam_adventures') || '[]')
        const adventure = {
          id: Date.now(),
          vibe: selectedVibe,
          vibeName,
          totalHours: selectedDuration,
          stops: itinerary,
          createdAt: new Date().toISOString()
        }
        localStorage.setItem('roam_adventures', JSON.stringify([adventure, ...saved].slice(0, 10)))
        toast.success('Saved locally! Sign in to share.')
      } else {
        toast.error('Failed to save')
      }
    } catch (err) {
      console.error('Save error:', err)
      toast.error('Failed to save')
    } finally {
      setIsSaving(false)
    }
  }, [itinerary, selectedVibe, selectedDuration, selectedTransport, travelTimes, toast, isSaving])

  // Share - opens modal
  const openShare = useCallback(() => {
    if (!itinerary.length) { toast.info('Add stops first'); return }
    setShowShareModal(true)
  }, [itinerary, toast])

  // Format time
  const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // Get leg key for travel time cache
  const getLegKey = (fromStop, toStop) => `${fromStop.id}-${toStop.id}`

  // Get transport mode for a specific leg
  const getLegMode = useCallback((fromStop) => {
    return fromStop.transportToNext || selectedTransport
  }, [selectedTransport])

  // Get cached or calculate travel time for a leg
  const getTravelTimeForLeg = useCallback((fromStop, toStop) => {
    if (!fromStop || !toStop) return null

    const legKey = getLegKey(fromStop, toStop)
    const mode = getLegMode(fromStop)

    // Check cache first
    const cached = travelTimes[legKey]
    if (cached && cached.mode === mode) {
      return cached
    }

    // Calculate fallback while waiting for API
    const dist = calcDist(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng)
    const speed = TRANSPORT_MODES.find(m => m.key === mode)?.speed || 5
    return {
      duration: Math.round((dist / speed) * 60),
      mode,
      source: 'fallback'
    }
  }, [travelTimes, getLegMode, calcDist])

  // Fetch travel time from API and cache it
  const updateTravelTime = useCallback(async (fromStop, toStop, mode) => {
    if (!fromStop || !toStop) return

    const legKey = getLegKey(fromStop, toStop)

    try {
      const result = await fetchTravelTime(
        { lat: fromStop.lat, lng: fromStop.lng },
        { lat: toStop.lat, lng: toStop.lng },
        mode
      )

      setTravelTimes(prev => ({
        ...prev,
        [legKey]: { ...result, mode }
      }))

      return result
    } catch (err) {
      console.warn('Failed to fetch travel time:', err)
    }
  }, [fetchTravelTime])

  // Change transport mode for a specific leg
  const changeLegMode = useCallback(async (legIndex, newMode) => {
    const fromStop = itinerary[legIndex]
    const toStop = itinerary[legIndex + 1]

    if (!fromStop || !toStop) return

    // Update the stop's transportToNext field
    setItinerary(prev => prev.map((s, i) =>
      i === legIndex ? { ...s, transportToNext: newMode } : s
    ))

    // Fetch new travel time
    await updateTravelTime(fromStop, toStop, newMode)

    // Close the mode picker
    setEditingLegIndex(null)
  }, [itinerary, updateTravelTime])

  // Fetch travel times when itinerary changes
  useEffect(() => {
    if (itinerary.length < 2) return

    // Fetch travel times for all legs
    itinerary.forEach((stop, idx) => {
      if (idx < itinerary.length - 1) {
        const nextStop = itinerary[idx + 1]
        const mode = getLegMode(stop)
        updateTravelTime(stop, nextStop, mode)
      }
    })
  }, [itinerary, getLegMode, updateTravelTime])

  // Available wishlist items
  const availableWishlist = useMemo(() => {
    const usedIds = itinerary.map(s => s.id)
    return wishlist.filter(w => !usedIds.includes(w.id))
  }, [wishlist, itinerary])

  // Open settings sheet - save initial values for comparison
  const openSettings = useCallback(() => {
    setInitialSettings({
      vibe: selectedVibe,
      duration: selectedDuration,
      transport: selectedTransport,
      radius: selectedRadius
    })
    setShowSettings(true)
  }, [selectedVibe, selectedDuration, selectedTransport, selectedRadius])

  // Close settings sheet - warn if there are unsaved changes and itinerary exists
  const closeSettings = useCallback((applyChanges = true) => {
    if (initialSettings && itinerary.length > 0 && !applyChanges) {
      const hasChanges =
        initialSettings.vibe !== selectedVibe ||
        initialSettings.duration !== selectedDuration ||
        initialSettings.transport !== selectedTransport ||
        initialSettings.radius !== selectedRadius

      if (hasChanges) {
        toast.info('Settings changed - regenerate to apply')
      }
    }
    setShowSettings(false)
    setInitialSettings(null)
  }, [initialSettings, itinerary.length, selectedVibe, selectedDuration, selectedTransport, selectedRadius, toast])

  const vibeName = VIBES.find(v => v.key === selectedVibe)?.label

  const durationLabel = DURATIONS.find(d => d.hours === selectedDuration)?.label
  const transportData = TRANSPORT_MODES.find(t => t.key === selectedTransport)
  const radiusData = RADIUS_OPTIONS.find(r => r.key === selectedRadius)

  return (
    <div className="plan-page">
      {/* Share Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        itinerary={itinerary}
        vibe={vibeName}
        shareCode={shareCode}
      />

      {/* Settings Bottom Sheet */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              className="plan-settings-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => closeSettings(false)}
            />
            <motion.div
              className="plan-settings-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div className="plan-settings-handle" />
              <h3 className="plan-settings-title">Adventure Settings</h3>

              <div className="plan-settings-section">
                <span className="plan-settings-label">Vibe</span>
                <div className="plan-settings-options">
                  {VIBES.map(v => (
                    <button
                      key={v.key}
                      className={`plan-settings-option ${selectedVibe === v.key ? 'active' : ''}`}
                      onClick={() => setSelectedVibe(v.key)}
                    >
                      <span className="plan-settings-option-icon">
                        <VibeIcon name={v.key} size={20} />
                      </span>
                      <span>{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="plan-settings-section">
                <span className="plan-settings-label">Duration</span>
                <div className="plan-settings-options">
                  {DURATIONS.map(d => (
                    <button
                      key={d.hours}
                      className={`plan-settings-option ${selectedDuration === d.hours ? 'active' : ''}`}
                      onClick={() => setSelectedDuration(d.hours)}
                    >
                      <span>{d.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="plan-settings-section">
                <span className="plan-settings-label">Travel By</span>
                <div className="plan-settings-options">
                  {TRANSPORT_MODES.map(t => (
                    <button
                      key={t.key}
                      className={`plan-settings-option ${selectedTransport === t.key ? 'active' : ''}`}
                      onClick={() => setSelectedTransport(t.key)}
                    >
                      <span className="plan-settings-option-icon">
                        <FilterIcon name={t.key} size={20} />
                      </span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="plan-settings-section">
                <span className="plan-settings-label">Search Radius</span>
                <div className="plan-settings-options">
                  {RADIUS_OPTIONS.map(r => (
                    <button
                      key={r.key}
                      className={`plan-settings-option ${selectedRadius === r.key ? 'active' : ''}`}
                      onClick={() => setSelectedRadius(r.key)}
                    >
                      <span>{r.label}</span>
                      <span className="plan-settings-option-sub">{r.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button className="plan-settings-done" onClick={() => closeSettings(true)}>
                Done
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="plan-body">
        {/* Adventure Summary Card */}
        <div className="plan-adventure-card" onClick={openSettings}>
          <div className="plan-adventure-icon">
            <VibeIcon name={selectedVibe} size={32} />
          </div>
          <div className="plan-adventure-info">
            <div className="plan-adventure-title">{vibeName} Adventure</div>
            <div className="plan-adventure-details">
              {durationLabel}
              <span className="plan-adventure-sep"> · </span>
              <FilterIcon name={transportData?.key || 'walk'} size={14} />
              <span>{transportData?.label}</span>
              <span className="plan-adventure-sep"> · </span>
              {radiusData?.description}
            </div>
          </div>
          <button className="plan-adventure-edit" aria-label="Edit settings">
            <SettingsIcon />
          </button>
        </div>

        {/* Generate button */}
        <button className="plan-generate" onClick={() => generate(0)} disabled={!location || isGenerating}>
          {isGenerating ? (
            <>
              <span className="plan-generate-spinner" />
              Finding places...
            </>
          ) : (
            'Generate Itinerary'
          )}
        </button>

        {/* YOUR ITINERARY - Main content */}
        <section className="plan-section plan-itinerary-section">
          <div className="plan-section-header">
            <span className="plan-section-title">YOUR ITINERARY</span>
            {itinerary.length > 0 && (
              <div className="plan-itinerary-actions">
                <button className="plan-action" onClick={openShare} aria-label="Share">
                  <ShareIcon /> Share
                </button>
                <button className="plan-action primary" onClick={save} aria-label="Save" disabled={isSaving}>
                  <SaveIcon /> {isSaving ? 'Saving...' : (shareCode ? 'Saved' : 'Save')}
                </button>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="plan-timeline">
            {itinerary.length > 0 ? (
              <Reorder.Group
                axis="y"
                values={itinerary}
                onReorder={handleReorder}
                className="plan-timeline-list"
              >
                {itinerary.map((stop, idx) => (
                  <Reorder.Item
                    key={stop.id}
                    value={stop}
                    className="plan-stop-wrapper"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="plan-stop">
                      <div className="plan-stop-time-wrapper">
                        {editingTimeIndex === idx ? (
                          <input
                            type="time"
                            className="plan-stop-time-input"
                            defaultValue={new Date(stop.scheduledTime).toTimeString().slice(0, 5)}
                            onBlur={(e) => updateStopTime(idx, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') updateStopTime(idx, e.target.value)
                              if (e.key === 'Escape') setEditingTimeIndex(null)
                            }}
                            autoFocus
                          />
                        ) : (
                          <button
                            className="plan-stop-time"
                            onClick={() => setEditingTimeIndex(idx)}
                            title="Click to edit time"
                          >
                            {formatTime(stop.scheduledTime)}
                          </button>
                        )}
                      </div>
                      <motion.div
                        className="plan-stop-card"
                        key={stop.id}
                        initial={{ opacity: 0, scale: 0.95, x: 10 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95, x: -10 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        whileTap={{ scale: 0.98 }}
                        layout
                      >
                        <div className="plan-stop-drag"><DragIcon /></div>
                        <div className="plan-stop-info">
                          <div className="plan-stop-name">{stop.name}</div>
                          <div className="plan-stop-meta">
                            {stop.type?.replace(/_/g, ' ')}
                            {stop.distance && ` · ${formatDistance(stop.distance)}`}
                          </div>
                        </div>
                        <div className="plan-stop-actions">
                          <button onClick={() => removeStop(idx)} aria-label="Remove"><CloseIcon /></button>
                          <button onClick={() => shuffleStop(idx)} aria-label="Shuffle"><ShuffleIcon /></button>
                        </div>
                      </motion.div>
                    </div>
                    {idx < itinerary.length - 1 && (
                      <div className="plan-travel">
                        <button
                          className="plan-travel-btn"
                          onClick={() => setEditingLegIndex(editingLegIndex === idx ? null : idx)}
                          aria-label={`Change transport mode for leg ${idx + 1}`}
                        >
                          {(() => {
                            const travelInfo = getTravelTimeForLeg(stop, itinerary[idx + 1])
                            const mode = getLegMode(stop)
                            const modeData = TRANSPORT_MODES.find(m => m.key === mode)
                            const prefix = travelInfo?.source === 'fallback' ? '~' : ''
                            return (
                              <>
                                <FilterIcon name={modeData?.key || 'walk'} size={14} />
                                <span className="plan-travel-duration">
                                  {prefix}{travelInfo?.duration || '?'} min
                                </span>
                              </>
                            )
                          })()}
                        </button>
                        <AnimatePresence>
                          {editingLegIndex === idx && (
                            <motion.div
                              className="plan-travel-picker"
                              initial={{ opacity: 0, y: -10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -10, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                            >
                              {TRANSPORT_MODES.map(mode => (
                                <button
                                  key={mode.key}
                                  className={`plan-travel-option ${getLegMode(stop) === mode.key ? 'active' : ''}`}
                                  onClick={() => changeLegMode(idx, mode.key)}
                                >
                                  <FilterIcon name={mode.key} size={20} />
                                  <span>{mode.label}</span>
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            ) : (
              <div className="plan-empty">
                <p>Generate an itinerary or add from your wishlist</p>
              </div>
            )}

            {itinerary.length > 0 && availableWishlist.length > 0 && (
              <button className="plan-add-stop" onClick={() => addStop(availableWishlist[0])}>
                <PlusIcon /> Add Stop
              </button>
            )}
          </div>
        </section>

        {/* FROM YOUR WISHLIST - Quick-add section */}
        <section className="plan-section plan-wishlist-section">
          <div className="plan-section-header">
            <span className="plan-section-title">FROM YOUR WISHLIST</span>
            {wishlist.length > 0 && (
              <button className="plan-section-link" onClick={() => navigate('/wishlist')}>
                View All ({wishlist.length}) <ChevronIcon />
              </button>
            )}
          </div>
          {availableWishlist.length > 0 ? (
            <div className="plan-wishlist">
              {availableWishlist.slice(0, 6).map(item => (
                <button
                  key={item.id}
                  className="plan-wishlist-item"
                  onClick={() => addStop(item)}
                  disabled={!item.lat || !item.lng}
                  title={!item.lat || !item.lng ? 'Missing location data' : `Add ${item.name} to itinerary`}
                >
                  <span className="plan-wishlist-name">{item.name}</span>
                  <span className="plan-wishlist-type">{item.type?.replace(/_/g, ' ')}</span>
                  <span className="plan-wishlist-add"><PlusIcon /></span>
                </button>
              ))}
              {availableWishlist.length > 6 && (
                <button className="plan-wishlist-more" onClick={() => navigate('/wishlist')}>
                  +{availableWishlist.length - 6} more
                </button>
              )}
            </div>
          ) : wishlist.length > 0 ? (
            <div className="plan-wishlist-empty">
              <span className="plan-wishlist-empty-icon" aria-hidden="true">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <p>All your saved places are in the itinerary!</p>
            </div>
          ) : (
            <div className="plan-wishlist-empty">
              <span className="plan-wishlist-empty-icon" aria-hidden="true">
                {/* Was 📍 emoji — replaced with a branded map-pin SVG
                    so the empty state matches the rest of ROAM's icon
                    language instead of rendering the platform's
                    default pin emoji. */}
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <p>Save places while exploring to add them here</p>
              <button className="plan-wishlist-cta" onClick={() => navigate('/')}>
                Discover Places
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
