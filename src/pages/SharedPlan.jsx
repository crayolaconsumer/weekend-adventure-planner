/**
 * SharedPlan - Public view of a shared adventure plan
 *
 * Route: /plan/share/:code
 * No authentication required
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import LoadingState from '../components/LoadingState'
import { downloadICS } from '../components/plan/CalendarExport'
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

const VIBE_ICONS = {
  mixed: '🎲',
  foodie: '🍽️',
  culture: '🎭',
  nature: '🌿'
}

export default function SharedPlan() {
  const { code } = useParams()
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch(`/api/plans/share/${code}`)
        if (!res.ok) {
          if (res.status === 404) {
            setError('Plan not found or no longer public')
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
  }

  const openDirections = (stop) => {
    const data = stop.placeData
    if (data?.lat && data?.lng) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${data.lat},${data.lng}`,
        '_blank',
        'noopener,noreferrer'
      )
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
          <span className="shared-plan-error-icon">🗺️</span>
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
          {VIBE_ICONS[plan.vibe] || '🎲'} {plan.vibe}
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
                    <div className="shared-plan-stop-icon">{data?.category?.icon || '📍'}</div>
                    <div className="shared-plan-stop-details">
                      <h3 className="shared-plan-stop-name">{data?.name || 'Unknown place'}</h3>
                      <p className="shared-plan-stop-meta">
                        {data?.type?.replace(/_/g, ' ')}
                        {data?.address && ` · ${data.address}`}
                      </p>
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
    </div>
  )
}
