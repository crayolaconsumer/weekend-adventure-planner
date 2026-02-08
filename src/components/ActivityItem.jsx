/**
 * ActivityItem Component
 *
 * Rich activity card that displays different activity types with place context:
 * - Visits with thumbs up/down
 * - Tips with place info
 * - Photos with thumbnails
 * - Ratings with recommendations
 */

import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from '../utils/dateUtils'
import './ActivityItem.css'

// Category icons mapping
const CATEGORY_ICONS = {
  restaurant: '🍽️',
  cafe: '☕',
  bar: '🍺',
  pub: '🍺',
  fast_food: '🍔',
  museum: '🏛️',
  park: '🌳',
  cinema: '🎬',
  theatre: '🎭',
  gallery: '🎨',
  viewpoint: '👀',
  attraction: '⭐',
  hotel: '🏨',
  shop: '🛍️',
  default: '📍'
}

// Get icon for category
function getCategoryIcon(category) {
  if (!category) return CATEGORY_ICONS.default
  const key = category.toLowerCase().replace(/[_-]/g, '_')
  return CATEGORY_ICONS[key] || CATEGORY_ICONS.default
}

// Get verb for activity type
function getActivityVerb(type, rating) {
  switch (type) {
    case 'visit':
      if (rating === null || rating === undefined) return 'visited'
      return rating > 3 ? 'visited and recommends' : 'visited'
    case 'tip':
      return 'shared a tip about'
    case 'photo':
      return 'shared a photo from'
    case 'rating':
      return rating > 3 ? 'recommends' : "doesn't recommend"
    default:
      return 'shared activity about'
  }
}

// Placeholder images by category
function getPlaceholderImage(category) {
  // Return a subtle gradient placeholder based on category
  return null // Let CSS handle placeholder styling
}

// Icons
const ThumbsUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
)

const ThumbsDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
  </svg>
)

const BookmarkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

const CheckCircleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  </svg>
)

export default function ActivityItem({ activity, index = 0, onSavePlace, hasVisited }) {
  const avatarUrl = activity.user?.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(activity.user?.displayName || activity.user?.username || 'U')}&background=E07A5F&color=fff`

  const timeAgo = activity.createdAt ? formatDistanceToNow(new Date(activity.createdAt)) : ''

  const verb = getActivityVerb(activity.type, activity.rating)
  const categoryIcon = getCategoryIcon(activity.place?.category)
  const isPositive = activity.rating === null || activity.rating === undefined || activity.rating > 3
  const placeImage = activity.place?.imageUrl || activity.metadata?.photoUrl

  // Handle save place click
  const handleSaveClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (onSavePlace && activity.place) {
      onSavePlace(activity.place)
    }
  }

  return (
    <motion.article
      className="activity-item-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      {/* Place image/thumbnail */}
      <div className="activity-item-media">
        {placeImage ? (
          <img
            src={placeImage}
            alt={activity.place?.name || 'Place'}
            className="activity-item-image"
            loading="lazy"
          />
        ) : (
          <div className="activity-item-image-placeholder">
            <span className="activity-item-category-icon">{categoryIcon}</span>
          </div>
        )}
        {activity.place?.category && (
          <span className="activity-item-category-badge" title={activity.place.category}>
            {categoryIcon}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="activity-item-body">
        {/* Header: User + Action + Place */}
        <header className="activity-item-header">
          <Link to={`/user/${activity.user?.username}`} className="activity-item-avatar-link">
            <img
              src={avatarUrl}
              alt={activity.user?.displayName || activity.user?.username}
              className="activity-item-avatar"
            />
          </Link>
          <div className="activity-item-meta">
            <p className="activity-item-action-line">
              <Link to={`/user/${activity.user?.username}`} className="activity-item-username">
                {activity.user?.displayName || activity.user?.username}
              </Link>
              <span className="activity-item-verb">{verb}</span>
              {activity.place?.name && (
                <span className="activity-item-place-name">
                  {activity.place.name}
                </span>
              )}
            </p>
            <span className="activity-item-time">{timeAgo}</span>
          </div>
        </header>

        {/* Rating indicator for visits */}
        {activity.type === 'visit' && activity.rating !== null && activity.rating !== undefined && (
          <div className={`activity-item-rating ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? <ThumbsUpIcon /> : <ThumbsDownIcon />}
            <span>{isPositive ? 'Recommends' : "Doesn't recommend"}</span>
          </div>
        )}

        {/* Content text (tip, note, review) */}
        {activity.content && (
          <p className="activity-item-content-text">{activity.content}</p>
        )}

        {/* Photo thumbnail for photo contributions */}
        {activity.type === 'photo' && activity.metadata?.photoUrl && (
          <div className="activity-item-photo-preview">
            <img
              src={activity.metadata.photoUrl}
              alt="Shared photo"
              className="activity-item-photo"
              loading="lazy"
            />
          </div>
        )}

        {/* Footer: Score + Actions */}
        <footer className="activity-item-footer">
          <div className="activity-item-stats">
            {activity.upvotes > 0 && (
              <span className="activity-item-helpful">
                <ThumbsUpIcon />
                {activity.upvotes} helpful
              </span>
            )}
          </div>

          <div className="activity-item-actions">
            {/* "You've been here" badge */}
            {hasVisited && (
              <span className="activity-item-visited-badge">
                <CheckCircleIcon />
                You've been here
              </span>
            )}

            {/* "Want to go" button */}
            {onSavePlace && activity.place?.id && !hasVisited && (
              <button
                className="activity-item-save-btn"
                onClick={handleSaveClick}
                title="Save to wishlist"
              >
                <BookmarkIcon />
                Want to go
              </button>
            )}
          </div>
        </footer>
      </div>
    </motion.article>
  )
}

// Skeleton loader for activity items
export function ActivityItemSkeleton() {
  return (
    <div className="activity-item-card activity-item-skeleton">
      <div className="activity-item-media">
        <div className="activity-item-image-placeholder skeleton" />
      </div>
      <div className="activity-item-body">
        <header className="activity-item-header">
          <div className="activity-item-avatar skeleton" />
          <div className="activity-item-meta">
            <div className="skeleton" style={{ width: '70%', height: '16px', marginBottom: '6px' }} />
            <div className="skeleton" style={{ width: '40%', height: '12px' }} />
          </div>
        </header>
        <div className="skeleton" style={{ width: '100%', height: '40px', marginTop: '12px' }} />
      </div>
    </div>
  )
}
