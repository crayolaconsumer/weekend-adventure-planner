/**
 * Social Proof Component
 *
 * Shows aggregate recommendation indicator for places.
 * Displays user's own rating or community stats.
 */

import { getPlaceSocialProof } from '../utils/ratingsStorage'
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

export default function SocialProof({ placeId, variant = 'compact' }) {
  const socialProof = getPlaceSocialProof(placeId)

  // Don't render if no ratings
  if (!socialProof.hasUserRating && socialProof.count === 0) {
    return null
  }

  // Show user's own rating if they've rated it
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

  // Show community stats (for future when we have server-side aggregation)
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

  return null
}
