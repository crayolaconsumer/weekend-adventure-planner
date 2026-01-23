import { useEffect, useRef, useCallback } from 'react'
import SwipeCard from './SwipeCard'
import './SponsoredCard.css'

// Generate or retrieve session ID for tracking
function getSessionId() {
  let sessionId = sessionStorage.getItem('roam_session_id')
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    sessionStorage.setItem('roam_session_id', sessionId)
  }
  return sessionId
}

export default function SponsoredCard({
  sponsoredPlace,
  place,
  onSwipe,
  onExpand,
  isTop = false,
  style = {},
  topContribution = null,
  userLocation = null
}) {
  const hasTrackedImpression = useRef(false)
  const sponsoredPlaceId = sponsoredPlace?.id

  // Track impression when card becomes visible (isTop)
  const trackImpression = useCallback(async () => {
    if (!sponsoredPlaceId || hasTrackedImpression.current) return

    hasTrackedImpression.current = true

    try {
      await fetch('/api/ads/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sponsored_place_id: sponsoredPlaceId,
          session_id: getSessionId(),
          user_lat: userLocation?.lat,
          user_lng: userLocation?.lng,
          action: 'impression'
        })
      })
    } catch (err) {
      // Silently fail - don't break UX for tracking
      console.warn('Failed to track impression:', err)
    }
  }, [sponsoredPlaceId, userLocation])

  // Track click when card is tapped/expanded
  const trackClick = useCallback(async () => {
    if (!sponsoredPlaceId) return

    try {
      await fetch('/api/ads/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sponsored_place_id: sponsoredPlaceId,
          session_id: getSessionId(),
          action: 'click'
        })
      })
    } catch (err) {
      console.warn('Failed to track click:', err)
    }
  }, [sponsoredPlaceId])

  // Track impression when card becomes the top card
  useEffect(() => {
    if (isTop) {
      trackImpression()
    }
  }, [isTop, trackImpression])

  // Wrap onExpand to track clicks
  const handleExpand = useCallback((placeData) => {
    trackClick()
    onExpand?.(placeData)
  }, [onExpand, trackClick])

  // Wrap onSwipe to track saves as conversions
  const handleSwipe = useCallback((action) => {
    if (action === 'like' || action === 'go') {
      // Track as a conversion (saved/go now)
      fetch('/api/ads/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sponsored_place_id: sponsoredPlaceId,
          session_id: getSessionId(),
          action: 'save'
        })
      }).catch(() => {})
    }
    onSwipe?.(action)
  }, [onSwipe, sponsoredPlaceId])

  return (
    <div className="sponsored-card-wrapper">
      {/* Sponsored badge - always visible */}
      <div className="sponsored-badge">
        <span className="sponsored-badge-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
        </span>
        Sponsored
      </div>

      <SwipeCard
        place={place}
        onSwipe={handleSwipe}
        onExpand={handleExpand}
        isTop={isTop}
        style={style}
        topContribution={topContribution}
      />
    </div>
  )
}
