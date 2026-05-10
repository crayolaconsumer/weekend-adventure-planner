import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import PremiumBadge from './PremiumBadge'
import { useSubscription } from '../hooks/useSubscription'
import { useOfflinePack } from '../hooks/useOfflinePack'
import {
  estimateSize,
  downloadPack,
  clearPack,
} from '../utils/offlinePack'
import './OfflinePackCard.css'

const RADIUS_OPTIONS = [2, 5, 10]

function formatBytes(b) {
  if (!b || b < 1024) return `${b || 0} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(0)} MB`
}

function formatAge(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function LockedTeaser() {
  return (
    <Link to="/pricing" className="offline-pack-card offline-pack-card--locked">
      <div className="offline-pack-card-badge"><PremiumBadge size="lg" showBevel={true} /></div>
      <div className="offline-pack-card-body">
        <span className="offline-pack-card-eyebrow">ROAM+</span>
        <span className="offline-pack-card-headline">Offline pack</span>
        <span className="offline-pack-card-sub">
          Download an area before you head out — perfect for hikes and holidays where signal drops. Tiles, places near you, and reviews all keep working without connection.
        </span>
        <span className="offline-pack-card-cta">Try free for 7 days →</span>
      </div>
    </Link>
  )
}

function PremiumVariant() {
  // Passively read cached geolocation (no prompt) so useOfflinePack can
  // compute distance and surface 'stale-distance' warnings. If perms
  // aren't granted, distance just stays null — graceful no-op.
  const [coords, setCoords] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation || !navigator.permissions) return
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' })
        if (perm.state !== 'granted') return
        navigator.geolocation.getCurrentPosition(
          (pos) => { if (!cancelled) setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
          () => {},
          { maximumAge: 30 * 60 * 1000, timeout: 4000 }
        )
      } catch { /* skip */ }
    })()
    return () => { cancelled = true }
  }, [])

  const { status, refresh } = useOfflinePack(coords)
  const [radius, setRadius] = useState(5)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(null) // { phase, current, total }
  const [error, setError] = useState(null)
  const [abortController, setAbortController] = useState(null)

  const requestLocation = useCallback(() => new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Your browser does not support location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED
        ? 'Location permission denied. Allow it in your browser to download a pack.'
        : 'Couldn\'t get your location. Please try again.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    )
  }), [])

  const handleDownload = async () => {
    setError(null)
    let coords
    try { coords = await requestLocation() } catch (err) {
      setError(err.message)
      return
    }
    const ctrl = new AbortController()
    setAbortController(ctrl)
    setDownloading(true)
    setProgress({ phase: 'tiles', current: 0, total: 1 })
    try {
      await downloadPack(coords, radius, (p) => setProgress(p), ctrl.signal)
      await refresh()
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message || 'Download failed')
    } finally {
      setDownloading(false)
      setProgress(null)
      setAbortController(null)
    }
  }

  const handleCancel = async () => {
    abortController?.abort()
    await clearPack()
    await refresh()
  }

  const handleClear = async () => {
    if (!confirm('Clear your offline pack? You can download a new one any time.')) return
    await clearPack()
    await refresh()
  }

  const estimated = formatBytes(estimateSize(radius))
  const isReady = status.state === 'fresh' || status.state === 'stale-time' || status.state === 'stale-distance'

  // Downloading takes precedence — useOfflinePack's status doesn't
  // update mid-download (no event fires for the 'downloading' manifest
  // write), so we'd otherwise render the stale active view with
  // disabled buttons instead of the progress bar.
  if (downloading) {
    const total = progress?.total || 1
    const current = progress?.current || 0
    const pct = Math.round((current / total) * 100)
    return (
      <div className="offline-pack-card offline-pack-card--active">
        <div className="offline-pack-card-header">
          <span className="offline-pack-card-eyebrow">ROAM+ · Downloading…</span>
          <PremiumBadge size="sm" />
        </div>
        <div className="offline-pack-progress-row">
          <div className="offline-pack-progress-bar">
            <motion.div className="offline-pack-progress-bar-fill"
              initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.3 }} />
          </div>
          <span className="offline-pack-progress-pct">{pct}%</span>
        </div>
        <p className="offline-pack-card-meta">
          {progress?.phase === 'tiles' && 'Map tiles…'}
          {progress?.phase === 'deck' && 'Discovery deck…'}
          {progress?.phase === 'place-details' && `Place details (${current}/${total})`}
          {progress?.phase === 'images' && `Images (${current}/${total})`}
        </p>
        <button className="offline-pack-card-btn-secondary" onClick={handleCancel}>Cancel</button>
      </div>
    )
  }

  // Active pack view
  if (isReady) {
    const m = status.manifest
    const ageMs = Date.now() - (m.downloadedAt || 0)
    return (
      <div className="offline-pack-card offline-pack-card--active">
        <div className="offline-pack-card-header">
          <span className="offline-pack-card-eyebrow">ROAM+ · Offline pack</span>
          <PremiumBadge size="sm" />
        </div>
        <h4 className="offline-pack-card-headline">
          {`${m.radiusKm} km area · ${m.placeIds?.length || 0} places`}
        </h4>
        <p className="offline-pack-card-meta">
          {`${formatBytes(m.byteSize)} · downloaded ${formatAge(ageMs)}`}
          {status.distanceKm != null && ` · you're ${status.distanceKm.toFixed(0)} km away`}
        </p>
        {(status.state === 'stale-time' || status.state === 'stale-distance') && (
          <div className="offline-pack-card-warning">
            {status.state === 'stale-time'
              ? `This pack is ${Math.floor(ageMs / (24 * 60 * 60 * 1000))} days old. Refresh?`
              : `Your pack is ${status.distanceKm?.toFixed(0)} km away. Download a new one?`}
          </div>
        )}
        <div className="offline-pack-card-actions">
          <button className="offline-pack-card-btn-secondary" onClick={handleDownload} disabled={downloading}>
            Replace
          </button>
          <button className="offline-pack-card-btn-secondary" onClick={handleClear} disabled={downloading}>
            Clear
          </button>
        </div>
      </div>
    )
  }

  // Idle view — pick radius and download
  const headline = status.state === 'expired'
    ? 'Your pack expired'
    : 'Download for offline'
  const subtext = status.state === 'expired'
    ? "It's been a while since this pack was downloaded. Grab a fresh one for where you are now."
    : "Perfect for trips where signal drops. Tap below to grab tiles + nearby places for the area you're in now."
  return (
    <div className="offline-pack-card offline-pack-card--active">
      <div className="offline-pack-card-header">
        <span className="offline-pack-card-eyebrow">ROAM+ · Offline pack</span>
        <PremiumBadge size="sm" />
      </div>
      <h4 className="offline-pack-card-headline">{headline}</h4>
      <p className="offline-pack-card-sub">{subtext}</p>
      <div className="offline-pack-radius-options" role="group" aria-label="Pack radius">
        {RADIUS_OPTIONS.map((r) => (
          <button
            key={r}
            type="button"
            className={`offline-pack-radius-option ${radius === r ? 'active' : ''}`}
            onClick={() => setRadius(r)}
          >
            {r} km
          </button>
        ))}
      </div>
      <p className="offline-pack-card-meta">Estimated size: ≈ {estimated}</p>
      {error && <p className="offline-pack-card-error">{error}</p>}
      <button className="offline-pack-card-btn-primary" onClick={handleDownload}>
        Download for this area
      </button>
    </div>
  )
}

export default function OfflinePackCard() {
  const { isPremium } = useSubscription()
  return isPremium ? <PremiumVariant /> : <LockedTeaser />
}
