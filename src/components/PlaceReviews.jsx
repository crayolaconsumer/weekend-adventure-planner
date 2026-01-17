/**
 * Place Reviews Component
 *
 * Shows the user's review and feedback for a place.
 */

import { getRating, VIBE_OPTIONS, NOISE_OPTIONS, VALUE_OPTIONS } from '../utils/ratingsStorage'
import './PlaceReviews.css'

// Icons
const ThumbsUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
  </svg>
)

const ThumbsDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
  </svg>
)

// Helper to get option label by value
function getOptionLabel(options, value) {
  const opt = options.find(o => o.value === value)
  return opt ? `${opt.icon} ${opt.label}` : null
}

export default function PlaceReviews({ placeId }) {
  const rating = getRating(placeId)

  if (!rating) {
    return null
  }

  const visitDate = new Date(rating.visitedAt)
  const formattedDate = visitDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

  const hasQuickFeedback = rating.vibe || rating.noiseLevel || rating.valueForMoney

  return (
    <div className="place-reviews">
      <h4 className="place-reviews-title">Your Review</h4>

      <div className="place-review-card">
        {/* Header with recommendation and date */}
        <div className="place-review-header">
          <div className={`place-review-recommendation ${rating.recommended ? 'positive' : 'negative'}`}>
            {rating.recommended ? <ThumbsUpIcon /> : <ThumbsDownIcon />}
            <span>{rating.recommended ? 'Recommended' : 'Not recommended'}</span>
          </div>
          <span className="place-review-date">{formattedDate}</span>
        </div>

        {/* Quick feedback tags */}
        {hasQuickFeedback && (
          <div className="place-review-tags">
            {rating.vibe && (
              <span className="place-review-tag">
                {getOptionLabel(VIBE_OPTIONS, rating.vibe)}
              </span>
            )}
            {rating.noiseLevel && (
              <span className="place-review-tag">
                {getOptionLabel(NOISE_OPTIONS, rating.noiseLevel)}
              </span>
            )}
            {rating.valueForMoney && (
              <span className="place-review-tag">
                {getOptionLabel(VALUE_OPTIONS, rating.valueForMoney)}
              </span>
            )}
          </div>
        )}

        {/* Text review */}
        {rating.review && (
          <p className="place-review-text">&ldquo;{rating.review}&rdquo;</p>
        )}
      </div>
    </div>
  )
}
