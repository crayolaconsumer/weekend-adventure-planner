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
import { usePlaceRatings } from '../hooks/usePlaceRatings'
import VisitedMapLeaflet from '../components/visitedMap/VisitedMapLeaflet'
import VisitedMapList from '../components/visitedMap/VisitedMapList'
import EditReviewModal from '../components/visitedMap/EditReviewModal'
import TeaserLanding from '../components/visitedMap/TeaserLanding'
import UpgradePrompt from '../components/UpgradePrompt'
import { formatDisplayName } from '../utils/displayName'
import { useSubscription } from '../hooks/useSubscription'
import PremiumBadge from '../components/PremiumBadge'
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

const PosterIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="3" width="14" height="18" rx="2"/>
    <path d="M9 7h6"/>
    <path d="M9 11h6"/>
    <path d="M9 15h4"/>
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
  const [editingPlace, setEditingPlace] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const { isPremium } = useSubscription()

  // NOTE: usePlaceRatings returns the VIEWER's own ratings, not the
  // target user's. So reviews appear on the list only when viewing
  // your own profile. A public ratings endpoint is sub-project #2
  // follow-up work to surface other users' reviews here.
  const { ratings } = usePlaceRatings()

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

  // Owner-only export to a high-res printable PNG poster.
  // Premium-gated server-side; we mirror the gate client-side to skip
  // the network round-trip and surface the upgrade modal directly.
  const handleExportPoster = async () => {
    if (!isPremium) {
      setShowUpgrade(true)
      return
    }
    setExporting(true)
    try {
      const res = await fetch(`/api/og/user-map-poster/${encodeURIComponent(username)}`, {
        headers: getAuthHeaders(),
        credentials: 'include'
      })
      if (res.status === 402) {
        setShowUpgrade(true)
        return
      }
      if (!res.ok) {
        throw new Error('Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${username}-roam-map.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke after a tick to let download start
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.error('Poster export failed', err)
    } finally {
      setExporting(false)
    }
  }

  const handleShare = async () => {
    // Use the share-prerender redirect URL so og:image meta tags fire
    // for link unfurlers (iMessage/WhatsApp/Slack/Twitter).
    const url = `${window.location.origin}/api/share/user-map/${encodeURIComponent(username)}`
    const title = `${formatDisplayName(data?.user) || username}'s ROAM map`
    const text = `Check out the places ${formatDisplayName(data?.user) || username} has visited on ROAM`
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
            <span className="avatar-with-premium">
              <img src={data.user.avatarUrl} alt="" className="visited-map-avatar" />
              {data.user.isPremium && <PremiumBadge size="sm" />}
            </span>
          )}
          <div className="visited-map-user-text">
            <span className="visited-map-user-name">
              {formatDisplayName(data.user)}
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
        <TeaserLanding
          user={data.user}
          placesAbstract={data.placesAbstract || []}
          total={data.total}
        />
      ) : (
        <div className="visited-map-body">
          <div className="visited-map-map-region">
            <VisitedMapLeaflet
              places={data.visited || []}
              onPinTap={setFocusedPlaceId}
              focusedPlaceId={focusedPlaceId}
            />
          </div>
          <div className="visited-map-list-region">
            <VisitedMapList
              places={data.visited || []}
              ratings={ratings}
              canEdit={isOwner}
              focusedPlaceId={focusedPlaceId}
              onRowTap={setFocusedPlaceId}
              onEditClick={setEditingPlace}
            />
          </div>
        </div>
      )}

      {/* Owner-only export-poster floating action — only render when owner viewing own full map */}
      {isOwner && !isTeaser && (data.visited?.length ?? 0) > 0 && (
        <button
          type="button"
          className="visited-map-export-fab"
          onClick={handleExportPoster}
          disabled={exporting}
          aria-label={isPremium ? 'Export your map as a poster' : 'Get a printable map poster with ROAM+'}
        >
          <PosterIcon />
          <span>{exporting ? 'Generating poster...' : 'Export poster'}</span>
          {!isPremium && <PremiumBadge size="xs" className="visited-map-export-fab-badge" />}
        </button>
      )}

      {editingPlace && (
        <EditReviewModal
          place={editingPlace}
          onClose={() => setEditingPlace(null)}
          onSaved={() => { /* optimistic update is handled by ratePlace */ }}
        />
      )}

      {showUpgrade && (
        <UpgradePrompt
          type="export"
          isOpen={showUpgrade}
          onClose={() => setShowUpgrade(false)}
          onUpgrade={() => setShowUpgrade(false)}
        />
      )}
    </motion.div>
  )
}
