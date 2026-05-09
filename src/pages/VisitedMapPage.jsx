/**
 * VisitedMapPage
 * Route: /user/:username/map
 *
 * Renders a real Leaflet map + accordion list of a user's visited places.
 * Privacy is enforced server-side via /api/users/[username]/visited which
 * returns either:
 *   - { visibility: 'full', visited: [...] } — own / public / follower
 *   - { visibility: 'teaser', placesAbstract: [...] } — non-follower
 *   - 404 — private account or blocked
 */

import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import './VisitedMapPage.css'

const ArrowLeftIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12"/>
    <polyline points="12 19 5 12 12 5"/>
  </svg>
)

const ShareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/>
    <circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
)

function getAuthHeaders() {
  const token = localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function VisitedMapPage() {
  const { username } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user: currentUser } = useAuth()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [focusedPlaceId, setFocusedPlaceId] = useState(null)

  // Read ?focus=:placeId to deep-link into a specific row (used by contextual hooks)
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (focus) setFocusedPlaceId(focus)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/visited`, {
          headers: getAuthHeaders(),
          credentials: 'include'
        })
        if (cancelled) return
        if (res.status === 404) {
          setError('not_found')
          return
        }
        if (!res.ok) {
          setError('load_failed')
          return
        }
        const json = await res.json()
        if (cancelled) return
        setData(json)
      } catch {
        if (!cancelled) setError('load_failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [username])

  const handleShare = async () => {
    const url = `${window.location.origin}/user/${encodeURIComponent(username)}/map`
    const title = `${data?.user?.displayName || username}'s ROAM map`
    const text = `Check out the places ${data?.user?.displayName || username} has visited on ROAM`
    if (navigator.share) {
      try { await navigator.share({ url, title, text }) } catch { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url)
      } catch { /* clipboard blocked */ }
    }
  }

  if (loading) {
    return (
      <div className="visited-map-page loading">
        <div className="visited-map-spinner" />
      </div>
    )
  }
  if (error === 'not_found' || !data) {
    return (
      <div className="visited-map-page error">
        <h2>This map isn't available</h2>
        <p>It might be private, or the user doesn't exist.</p>
        <Link to="/">Back to ROAM</Link>
      </div>
    )
  }
  if (error === 'load_failed') {
    return (
      <div className="visited-map-page error">
        <h2>Couldn't load this map</h2>
        <button onClick={() => navigate(0)}>Try again</button>
      </div>
    )
  }

  const isOwner = currentUser?.id === data.user?.id
  const isTeaser = data.visibility === 'teaser'

  return (
    <motion.div
      className="visited-map-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <header className="visited-map-header">
        <button className="visited-map-back" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <Link to={`/user/${data.user.username}`} className="visited-map-user">
          {data.user.avatarUrl && (
            <img src={data.user.avatarUrl} alt="" className="visited-map-avatar" />
          )}
          <div className="visited-map-user-text">
            <span className="visited-map-user-name">
              {data.user.displayName || data.user.username}
            </span>
            <span className="visited-map-user-count">
              {data.total} {data.total === 1 ? 'place' : 'places'}
            </span>
          </div>
        </Link>
        <button className="visited-map-share" onClick={handleShare} aria-label="Share map">
          <ShareIcon />
        </button>
      </header>

      {isTeaser ? (
        <div className="visited-map-teaser-placeholder">
          {/* Phase 9 Task 20 replaces this with the full teaser landing UI */}
          <p>This map is for followers only.</p>
          <p>Sign in to follow {data.user.displayName || data.user.username} and see the real map.</p>
        </div>
      ) : (
        <div className="visited-map-body">
          {/* TODO Task 9: <VisitedMapLeaflet places={data.visited} onPinTap={setFocusedPlaceId} focusedPlaceId={focusedPlaceId} /> */}
          {/* TODO Task 11: <VisitedMapList places={data.visited} canEdit={isOwner} focusedPlaceId={focusedPlaceId} onRowTap={setFocusedPlaceId} /> */}
          <div className="visited-map-placeholder">
            <p>Loaded {data.visited?.length || 0} places for {data.user.username}.</p>
            <p>Map and list arrive in the next phases.</p>
            {focusedPlaceId && (
              <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                Focused place id: <code>{focusedPlaceId}</code>
              </p>
            )}
            {isOwner && <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>(You're the owner — edit affordances will appear once the list lands.)</p>}
          </div>
        </div>
      )}
    </motion.div>
  )
}
