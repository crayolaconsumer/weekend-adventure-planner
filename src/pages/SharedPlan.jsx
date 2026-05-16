/**
 * SharedPlan - Public view of a shared adventure plan
 *
 * Route: /plan/share/:code
 * No authentication required
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import LoadingState from '../components/LoadingState'
import { downloadICS } from '../components/plan/CalendarExport'
import { useSEO } from '../hooks/useSEO'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import VibeIcon from '../components/icons/VibeIcon'
import CategoryIcon from '../components/icons/CategoryIcon'
import { tap as hapticTap, success as hapticSuccess } from '../utils/haptics'
import './SharedPlan.css'

const MapIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2"/>
    <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
  </svg>
)

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const DirectionsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

/* Lucide "thumbs-up" — used for vote-up on a shared-plan stop. */
const ThumbsUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 10v12" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4.27-9.45a.84.84 0 0 1 1.65.31z" />
  </svg>
)

/* Lucide "thumbs-down" — used for vote-down on a shared-plan stop. */
const ThumbsDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 14V2" />
    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-4.27 9.45a.84.84 0 0 1-1.65-.31z" />
  </svg>
)

const VIBE_LABELS = {
  mixed: 'Mix',
  foodie: 'Food',
  culture: 'Culture',
  nature: 'Outdoor',
}

export default function SharedPlan() {
  const { code } = useParams()
  const { isAuthenticated } = useAuth()
  const appToast = useToast()
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [pendingVoteStop, setPendingVoteStop] = useState(null) // optimistic-update guard

  /**
   * Vote up/down (or clear) on a stop. Optimistic update — flips the
   * local count immediately, then reconciles with the server response.
   * Falls back gracefully if the request fails.
   */
  const handleVote = useCallback(async (stopId, nextVote) => {
    if (!isAuthenticated) {
      appToast?.info?.('Sign in to vote on this plan')
      return
    }
    if (pendingVoteStop === stopId) return
    setPendingVoteStop(stopId)

    // Optimistic — flip the in-place vote then snap back if server
    // disagrees. Saves a render cycle of latency on tap.
    const prevPlan = plan
    setPlan(prev => {
      if (!prev) return prev
      return {
        ...prev,
        stops: prev.stops.map(s => {
          if (s.id !== stopId) return s
          const v = s.votes || { up: 0, down: 0 }
          const yourPrev = s.yourVote
          let up = v.up
          let down = v.down
          if (yourPrev === 'up') up -= 1
          if (yourPrev === 'down') down -= 1
          if (nextVote === 'up') up += 1
          if (nextVote === 'down') down += 1
          return { ...s, votes: { up: Math.max(0, up), down: Math.max(0, down) }, yourVote: nextVote }
        }),
      }
    })

    try {
      const res = await fetch(`/api/plans/share/${code}/vote`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopId, voteType: nextVote }),
      })
      if (!res.ok) throw new Error(`vote failed ${res.status}`)
      const data = await res.json()
      // Reconcile with server truth.
      setPlan(prev => prev ? {
        ...prev,
        stops: prev.stops.map(s => s.id === stopId
          ? { ...s, votes: data.votes, yourVote: data.yourVote }
          : s
        )
      } : prev)
      nextVote === null ? hapticTap('light') : hapticSuccess()
    } catch (err) {
      console.warn('Vote failed:', err)
      setPlan(prevPlan)
      appToast?.error?.("Couldn't save your vote")
    } finally {
      setPendingVoteStop(null)
    }
  }, [code, isAuthenticated, plan, pendingVoteStop, appToast])

  // Dynamic SEO for shared plans
  const planTitle = plan?.name || 'Shared Adventure'
  const placeCount = plan?.places?.length || 0
  const vibeLabel = plan?.vibe ? VIBE_LABELS[plan.vibe] || '' : ''
  useSEO({
    title: planTitle,
    description: `${vibeLabel ? `${vibeLabel} adventure — ` : ''}${placeCount} places to explore, shared via ROAM`,
    url: `https://www.go-roam.uk/plan/share/${code}`
  })

  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch(`/api/plans/share/${code}`)
        if (!res.ok) {
          if (res.status === 404) {
            setError('This adventure is no longer shared. Ask the owner to share it again.')
          } else {
            setError('Failed to load plan')
          }
          return
        }
        const data = await res.json()
        setPlan(data.plan)
      } catch (err) {
        console.error(err)
        setError('Failed to load plan')
      } finally {
        setLoading(false)
      }
    }
    fetchPlan()
  }, [code])

  // Update document meta tags for social sharing
  useEffect(() => {
    if (!plan) return

    const originalTitle = document.title
    const stopCount = plan.stops?.length || 0
    const description = `${plan.title} - ${stopCount} stop adventure by @${plan.user?.username || 'explorer'}. Check out this ROAM adventure plan!`
    const ogImageUrl = `${window.location.origin}/api/og/plan?code=${code}`

    // Update title
    document.title = `${plan.title} | ROAM Adventure`

    // Update or create meta tags
    const setMeta = (property, content) => {
      let meta = document.querySelector(`meta[property="${property}"]`)
      if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute('property', property)
        document.head.appendChild(meta)
      }
      meta.setAttribute('content', content)
    }

    setMeta('og:title', plan.title)
    setMeta('og:description', description)
    setMeta('og:image', ogImageUrl)
    setMeta('og:url', window.location.href)
    setMeta('twitter:title', plan.title)
    setMeta('twitter:description', description)
    setMeta('twitter:image', ogImageUrl)

    return () => {
      document.title = originalTitle
    }
  }, [plan, code])

  const formatTime = (timeStr) => {
    if (!timeStr) return ''
    // Handle both TIME format (HH:MM:SS) and ISO string
    if (timeStr.includes('T')) {
      return new Date(timeStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    }
    return timeStr.slice(0, 5)
  }

  const handleExportCalendar = () => {
    if (!plan) return
    const stops = plan.stops.map(s => ({
      ...s.placeData,
      scheduledTime: s.scheduledTime || new Date().toISOString(),
      duration: s.durationMinutes
    }))
    downloadICS(stops, plan.title)
    setToast('Added to calendar')
    setTimeout(() => setToast(null), 3000)
  }

  const openDirections = (stop) => {
    const data = stop.placeData
    if (data?.lat && data?.lng) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${data.lat},${data.lng}`
      import('../utils/nativePlugins').then(m => m.openExternalUrl(url))
    }
  }

  if (loading) {
    return (
      <div className="shared-plan-page">
        <LoadingState variant="spinner" message="Loading adventure..." size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="shared-plan-page">
        <div className="shared-plan-error">
          <h2>Adventure Not Found</h2>
          <p>{error}</p>
          <Link to="/" className="shared-plan-cta">Discover Places</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="shared-plan-page">
      <motion.header
        className="shared-plan-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="shared-plan-vibe">
          <VibeIcon name={plan.vibe || 'mixed'} size={16} />
          <span>{VIBE_LABELS[plan.vibe] || plan.vibe || 'Mix'}</span>
        </div>
        <h1 className="shared-plan-title">{plan.title}</h1>
        <div className="shared-plan-meta">
          <span>{plan.stops.length} stops</span>
          <span>·</span>
          <span>{plan.durationHours}h adventure</span>
          <span>·</span>
          <span>by @{plan.user.username}</span>
        </div>
      </motion.header>

      <div className="shared-plan-content">
        <div className="shared-plan-actions">
          <button className="shared-plan-action" onClick={handleExportCalendar}>
            <CalendarIcon />
            Add to Calendar
          </button>
        </div>

        <div className="shared-plan-timeline">
          {plan.stops.map((stop, idx) => {
            const data = stop.placeData
            return (
              <motion.div
                key={stop.id}
                className="shared-plan-stop"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <div className="shared-plan-stop-time">
                  {formatTime(stop.scheduledTime)}
                </div>
                <div className="shared-plan-stop-connector">
                  <div className="shared-plan-stop-dot" />
                  {idx < plan.stops.length - 1 && <div className="shared-plan-stop-line" />}
                </div>
                <div className="shared-plan-stop-card">
                  <div className="shared-plan-stop-info">
                    <div className="shared-plan-stop-icon">
                      <CategoryIcon name={data?.category?.key || 'unique'} size="lg" />
                    </div>
                    <div className="shared-plan-stop-details">
                      <h3 className="shared-plan-stop-name">{data?.name || 'Place details unavailable'}</h3>
                      <p className="shared-plan-stop-meta">
                        {data?.type?.replace(/_/g, ' ')}
                        {data?.address && ` · ${data.address}`}
                      </p>
                      {/* Co-plan vote chips — viewers can thumbs-up /
                          thumbs-down each stop. Owner sees the same
                          aggregate when they reopen the plan. */}
                      <div className="shared-plan-stop-votes" role="group" aria-label="Vote on this stop">
                        <button
                          type="button"
                          className={`shared-plan-vote up ${stop.yourVote === 'up' ? 'active' : ''}`}
                          onClick={() => handleVote(stop.id, stop.yourVote === 'up' ? null : 'up')}
                          aria-pressed={stop.yourVote === 'up'}
                          aria-label="Vote up"
                          disabled={pendingVoteStop === stop.id}
                        >
                          <ThumbsUpIcon />
                          <span className="shared-plan-vote-count">{stop.votes?.up || 0}</span>
                        </button>
                        <button
                          type="button"
                          className={`shared-plan-vote down ${stop.yourVote === 'down' ? 'active' : ''}`}
                          onClick={() => handleVote(stop.id, stop.yourVote === 'down' ? null : 'down')}
                          aria-pressed={stop.yourVote === 'down'}
                          aria-label="Vote down"
                          disabled={pendingVoteStop === stop.id}
                        >
                          <ThumbsDownIcon />
                          <span className="shared-plan-vote-count">{stop.votes?.down || 0}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    className="shared-plan-stop-directions"
                    onClick={() => openDirections(stop)}
                    aria-label="Get directions"
                  >
                    <DirectionsIcon />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>

        <div className="shared-plan-footer">
          <p>Want to create your own adventure?</p>
          <Link to="/plan" className="shared-plan-cta">
            <MapIcon />
            Plan Your Adventure
          </Link>
        </div>
      </div>

      {toast && (
        <motion.div
          className="shared-plan-toast"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
        >
          {toast}
        </motion.div>
      )}
    </div>
  )
}
