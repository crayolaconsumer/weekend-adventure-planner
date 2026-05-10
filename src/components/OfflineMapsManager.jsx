/**
 * OfflineMapsManager Component
 *
 * UI for downloading and managing offline map tiles.
 * Shows in Settings or as a prompt when user is online.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useOfflineMaps } from '../hooks/useOfflineMaps'
import './OfflineMapsManager.css'

export default function OfflineMapsManager({ userLocation: userLocationProp }) {
  const {
    isSupported,
    isPrefetching,
    prefetchProgress,
    prefetchArea,
    clearCache,
    estimateStorageUsed
  } = useOfflineMaps()

  const [storageInfo, setStorageInfo] = useState(null)
  const [radius, setRadius] = useState(5) // km
  const [downloadComplete, setDownloadComplete] = useState(false)
  // Self-detected geolocation as a fallback when the parent doesn't
  // pass userLocation (UnifiedProfile mounts us with null because it
  // doesn't track location itself). Defer the actual prompt until the
  // user clicks Download — that way we don't pop a permission dialog
  // for users who never look at the offline section.
  const [selfLocation, setSelfLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [requestingLocation, setRequestingLocation] = useState(false)

  const userLocation = userLocationProp || selfLocation

  // Load storage info on mount
  useEffect(() => {
    estimateStorageUsed().then(setStorageInfo)
  }, [estimateStorageUsed])

  const requestLocation = () => new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      setLocationError('Your browser does not support location.')
      resolve(null)
      return
    }
    setRequestingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRequestingLocation(false)
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setSelfLocation(loc)
        setLocationError(null)
        resolve(loc)
      },
      (err) => {
        setRequestingLocation(false)
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Allow it in your browser settings to download maps for your area.'
            : 'Couldn\'t get your location. Please try again.'
        )
        resolve(null)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    )
  })

  const handleDownload = async () => {
    let loc = userLocation
    if (!loc) {
      loc = await requestLocation()
      if (!loc) return
    }

    setDownloadComplete(false)
    const result = await prefetchArea({
      lat: loc.lat,
      lng: loc.lng,
      radiusKm: radius,
      minZoom: 12,
      maxZoom: 16
    })

    if (result.success) {
      setDownloadComplete(true)
      // Refresh storage info
      const info = await estimateStorageUsed()
      setStorageInfo(info)
    }
  }

  const handleClear = () => {
    clearCache()
    setStorageInfo({ tilesCount: 0, estimatedMB: '0' })
  }

  if (!isSupported) {
    return (
      <div className="offline-maps-manager">
        <div className="offline-maps-unsupported">
          <span className="offline-maps-icon">📵</span>
          <p>Offline maps are not supported in this browser.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="offline-maps-manager">
      <div className="offline-maps-header">
        <div>
          <h3>Offline Maps</h3>
          <p>Download maps for use without internet</p>
        </div>
      </div>

      {/* Storage info */}
      {storageInfo && (
        <div className="offline-maps-storage">
          <span className="storage-label">Cached tiles</span>
          <span className="storage-value">
            {storageInfo.tilesCount} tiles (~{storageInfo.estimatedMB} MB)
          </span>
        </div>
      )}

      {/* Download controls */}
      <div className="offline-maps-controls">
        <div className="radius-selector">
          <label htmlFor="offline-radius">Download radius</label>
          <div className="radius-options">
            {[2, 5, 10].map(r => (
              <button
                key={r}
                className={`radius-option ${radius === r ? 'active' : ''}`}
                onClick={() => setRadius(r)}
                disabled={isPrefetching}
              >
                {r} km
              </button>
            ))}
          </div>
        </div>

        {locationError && (
          <p className="offline-maps-warning">{locationError}</p>
        )}
        {!userLocation && !locationError && !requestingLocation && (
          <p className="offline-maps-hint">
            We&apos;ll ask for your location when you tap Download.
          </p>
        )}
        {requestingLocation && (
          <p className="offline-maps-hint">
            Getting your location…
          </p>
        )}

        <motion.button
          className="offline-maps-download-btn"
          onClick={handleDownload}
          disabled={isPrefetching || requestingLocation}
          whileTap={{ scale: 0.97 }}
        >
          {isPrefetching ? (
            <>
              <span className="download-spinner" />
              Downloading...
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Maps
            </>
          )}
        </motion.button>

        {/* Progress bar */}
        <AnimatePresence>
          {isPrefetching && (
            <motion.div
              className="offline-maps-progress"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="progress-bar">
                <motion.div
                  className="progress-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${prefetchProgress * 100}%` }}
                />
              </div>
              <span className="progress-text">
                {Math.round(prefetchProgress * 100)}%
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success message */}
        <AnimatePresence>
          {downloadComplete && !isPrefetching && (
            <motion.div
              className="offline-maps-success"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Maps downloaded! You can now use them offline.
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Clear cache */}
      {storageInfo && storageInfo.tilesCount > 0 && (
        <button
          className="offline-maps-clear-btn"
          onClick={handleClear}
          disabled={isPrefetching}
        >
          Clear cached maps
        </button>
      )}
    </div>
  )
}
