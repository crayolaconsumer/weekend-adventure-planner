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
import { filterPlaces, enhancePlace, getRandomQualityPlaces } from '../utils/placeFilter'
import { useToast } from '../hooks/useToast'
import ShareModal from '../components/plan/ShareModal'
import './Plan.css'

// Vibe options
const VIBES = [
  { key: 'mixed', label: 'Mix', categories: null },
  { key: 'foodie', label: 'Food', categories: ['food', 'nightlife'] },
  { key: 'culture', label: 'Culture', categories: ['culture', 'historic'] },
  { key: 'nature', label: 'Outdoor', categories: ['nature', 'active'] },
]

const DURATIONS = [
  { hours: 2, label: '2h', stops: 2 },
  { hours: 4, label: 'Half Day', stops: 3 },
  { hours: 6, label: 'Full Day', stops: 4 },
  { hours: 8, label: 'Epic', stops: 5 },
]

// Icons
const DragIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/>
    <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
    <circle cx="9" cy="19" r="2"/><circle cx="15" cy="19" r="2"/>
  </svg>
)

const ShuffleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16,3 21,3 21,8"/><line x1="4" y1="20" x2="21" y2="3"/>
    <polyline points="21,16 21,21 16,21"/><line x1="15" y1="15" x2="21" y2="21"/>
    <line x1="4" y1="4" x2="9" y2="9"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
)

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
  </svg>
)

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)

export default function Plan({ location }) {
  const toast = useToast()
  const navigate = useNavigate()

  // State
  const [selectedVibe, setSelectedVibe] = useState('mixed')
  const [selectedDuration, setSelectedDuration] = useState(4)
  const [itinerary, setItinerary] = useState([])
  const [wishlist, setWishlist] = useState([])
  const [availablePlaces, setAvailablePlaces] = useState([])
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareCode, setShareCode] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  // Load wishlist
  useEffect(() => {
    const load = () => {
      const saved = localStorage.getItem('roam_wishlist')
      if (saved) setWishlist(JSON.parse(saved))
    }
    load()
    window.addEventListener('storage', load)
    return () => window.removeEventListener('storage', load)
  }, [])

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

  // Generate itinerary
  const generate = async () => {
    if (!location) { toast.error('Need location'); return }

    const vibe = VIBES.find(v => v.key === selectedVibe)
    const duration = DURATIONS.find(d => d.hours === selectedDuration)

    try {
      const raw = await fetchEnrichedPlaces(location.lat, location.lng, 10000, null)
      const enhanced = raw.map(p => enhancePlace(p, location))
      const filtered = filterPlaces(enhanced, { categories: vibe.categories, minScore: 45, maxResults: 50 })
      setAvailablePlaces(filtered)

      const stops = getRandomQualityPlaces(filtered, duration.stops, { minScore: 45 })
      const optimized = optimizeRoute(stops, location)

      const startTime = new Date()
      startTime.setHours(10, 0, 0, 0)

      const withTimes = optimized.map((stop, i) => {
        const time = new Date(startTime)
        time.setMinutes(time.getMinutes() + i * 90)
        return {
          ...stop,
          scheduledTime: time.toISOString(),
          duration: 60,
          distance: calcDist(location.lat, location.lng, stop.lat, stop.lng)
        }
      })

      setItinerary(withTimes)
      toast.success(`${duration.stops} stops added!`)
    } catch (e) {
      console.error(e)
      toast.error('Failed to generate')
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
      time.setMinutes(time.getMinutes() + 90)
    } else {
      time.setHours(10, 0, 0, 0)
    }

    setItinerary(prev => [...prev, {
      ...place,
      scheduledTime: time.toISOString(),
      duration: 60,
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
        t.setMinutes(t.getMinutes() + i * 90)
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
    if (!candidates.length) { toast.info('No alternatives'); return }

    const sameCategory = candidates.filter(p => p.category?.key === current.category?.key)
    const pool = sameCategory.length ? sameCategory : candidates
    const replacement = pool[Math.floor(Math.random() * pool.length)]

    setItinerary(prev => prev.map((s, i) => i === index ? {
      ...replacement,
      scheduledTime: s.scheduledTime,
      duration: s.duration,
      distance: location ? calcDist(location.lat, location.lng, replacement.lat, replacement.lng) : null
    } : s))
    toast.success('Swapped!')
  }, [itinerary, availablePlaces, location, calcDist, toast])

  // Reorder
  const handleReorder = useCallback((newOrder) => {
    if (!newOrder.length) return
    const start = new Date(itinerary[0].scheduledTime)
    setItinerary(newOrder.map((s, i) => {
      const t = new Date(start)
      t.setMinutes(t.getMinutes() + i * 90)
      return { ...s, scheduledTime: t.toISOString() }
    }))
  }, [itinerary])

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
        isPublic: true,
        stops: itinerary.map(stop => ({
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
          durationMinutes: stop.duration || 60
        }))
      }

      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [itinerary, selectedVibe, selectedDuration, toast, isSaving])

  // Share - opens modal
  const openShare = useCallback(() => {
    if (!itinerary.length) { toast.info('Add stops first'); return }
    setShowShareModal(true)
  }, [itinerary, toast])

  // Format time
  const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // Travel time
  const getTravelTime = (from, to) => {
    if (!from || !to) return null
    const dist = calcDist(from.lat, from.lng, to.lat, to.lng)
    return Math.round((dist / 5) * 60) // walking speed 5km/h
  }

  // Available wishlist items
  const availableWishlist = useMemo(() => {
    const usedIds = itinerary.map(s => s.id)
    return wishlist.filter(w => !usedIds.includes(w.id))
  }, [wishlist, itinerary])

  const vibeName = VIBES.find(v => v.key === selectedVibe)?.label

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

      {/* Header */}
      <header className="plan-header">
        <h1 className="plan-title">Plan Your Adventure</h1>
      </header>

      <div className="plan-body">
        {/* VIBE: [chips] - inline */}
        <div className="plan-row">
          <span className="plan-label">VIBE:</span>
          <div className="plan-chips">
            {VIBES.map(v => (
              <button
                key={v.key}
                className={`plan-chip ${selectedVibe === v.key ? 'active' : ''}`}
                onClick={() => setSelectedVibe(v.key)}
                aria-pressed={selectedVibe === v.key}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* DURATION: [chips] - inline */}
        <div className="plan-row">
          <span className="plan-label">DURATION:</span>
          <div className="plan-chips">
            {DURATIONS.map(d => (
              <button
                key={d.hours}
                className={`plan-chip ${selectedDuration === d.hours ? 'active' : ''}`}
                onClick={() => setSelectedDuration(d.hours)}
                aria-pressed={selectedDuration === d.hours}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button className="plan-generate" onClick={generate} disabled={!location}>
          Generate Itinerary
        </button>

        {/* FROM YOUR WISHLIST */}
        {availableWishlist.length > 0 && (
          <section className="plan-section">
            <div className="plan-section-header">
              <span className="plan-section-title">FROM YOUR WISHLIST</span>
              <button className="plan-section-link" onClick={() => navigate('/wishlist')}>
                View All <ChevronIcon />
              </button>
            </div>
            <div className="plan-wishlist">
              {availableWishlist.slice(0, 4).map(item => (
                <button key={item.id} className="plan-wishlist-item" onClick={() => addStop(item)}>
                  <span className="plan-wishlist-name">{item.name}</span>
                  <span className="plan-wishlist-add"><PlusIcon /></span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* YOUR ITINERARY */}
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
            <AnimatePresence mode="popLayout">
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
                      className="plan-stop"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                    >
                      {/* Time */}
                      <div className="plan-stop-time">{formatTime(stop.scheduledTime)}</div>

                      {/* Connector */}
                      <div className="plan-stop-connector">
                        <div className="plan-stop-dot" />
                        {idx < itinerary.length - 1 && <div className="plan-stop-line" />}
                      </div>

                      {/* Card */}
                      <div className="plan-stop-card">
                        <div className="plan-stop-drag"><DragIcon /></div>
                        <div className="plan-stop-info">
                          <div className="plan-stop-name">{stop.name}</div>
                          <div className="plan-stop-meta">
                            {stop.type?.replace(/_/g, ' ')}
                            {stop.distance && ` · ${stop.distance < 1 ? Math.round(stop.distance * 1000) + 'm' : stop.distance.toFixed(1) + 'km'}`}
                          </div>
                        </div>
                        <div className="plan-stop-actions">
                          <button onClick={() => removeStop(idx)} aria-label="Remove"><CloseIcon /></button>
                          <button onClick={() => shuffleStop(idx)} aria-label="Shuffle"><ShuffleIcon /></button>
                        </div>
                      </div>

                      {/* Travel time */}
                      {idx < itinerary.length - 1 && (
                        <div className="plan-travel">
                          <span className="plan-travel-arrow">↓</span>
                          <span>{getTravelTime(stop, itinerary[idx + 1])} min walk</span>
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
            </AnimatePresence>

            {/* Add Stop */}
            {itinerary.length > 0 && availableWishlist.length > 0 && (
              <button className="plan-add-stop" onClick={() => addStop(availableWishlist[0])}>
                <PlusIcon /> Add Stop
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
