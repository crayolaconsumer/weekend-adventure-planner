/**
 * Social Proof Component
 *
 * Shows aggregate recommendation indicator for places.
 * Displays user's own rating, community stats, or taste-match signals.
 */

import { getPlaceSocialProof } from '../utils/ratingsStorage'
import { useTasteProfile } from '../hooks/useTasteProfile'
import './SocialProof.css'

// Icons
const HeartIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const SparkleIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z"/>
  </svg>
)

export default function SocialProof({ placeId, place = null, variant = 'compact' }) {
  const socialProof = getPlaceSocialProof(placeId)
  const { getMatchReason, isPersonalized } = useTasteProfile()

  // Get taste match reason if we have a place object
  const matchReason = place && isPersonalized ? getMatchReason(place) : null

  // Priority 1: Show user's own rating if they've rated it
  if (socialProof.hasUserRating) {
    return (
      <div className={`social-proof social-proof-${variant} ${socialProof.userRecommended ? 'recommended' : 'not-recommended'}`}>
        {socialProof.userRecommended ? (
          <>
            <HeartIcon />
            <span>You loved this</span>
          </>
        ) : (
          <>
            <CheckIcon />
            <span>You visited</span>
          </>
        )}
      </div>
    )
  }

  // Priority 2: Show community stats if available
  if (socialProof.count > 0) {
    const label = socialProof.count === 1
      ? '1 explorer loved this'
      : `${socialProof.count} explorers loved this`

    return (
      <div className={`social-proof social-proof-${variant} community`}>
        <HeartIcon />
        <span>{label}</span>
      </div>
    )
  }

  // Priority 3: Show taste match signal (personalized "for you" indicator)
  if (matchReason) {
    return (
      <div className={`social-proof social-proof-${variant} taste-match`}>
        <SparkleIcon />
        <span>{matchReason}</span>
      </div>
    )
  }

  return null
}
