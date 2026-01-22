/**
 * ActivityFeed Component
 *
 * Shows activity from users you follow
 */

import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useActivityFeed } from '../hooks/useSocial'
import { formatDistanceToNow } from '../utils/dateUtils'
import './ActivityFeed.css'

export default function ActivityFeed() {
  const { activities, loading, error, hasMore, loadMore } = useActivityFeed()

  if (loading && activities.length === 0) {
    return (
      <div className="activity-feed">
        {[...Array(3)].map((_, i) => (
          <ActivityItemSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="activity-feed-error">
        <p>Failed to load activity feed</p>
        <button onClick={() => window.location.reload()}>Try again</button>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="activity-feed-empty">
        <div className="activity-feed-empty-icon">👥</div>
        <h3>No activity yet</h3>
        <p>Follow some users to see their activity here!</p>
        <p className="activity-feed-empty-hint">
          Check the Discover tab to find people with similar interests!
        </p>
      </div>
    )
  }

  return (
    <div className="activity-feed">
      {activities.map((activity, index) => (
        <ActivityItem key={activity.id} activity={activity} index={index} />
      ))}

      {hasMore && (
        <button
          className="activity-feed-load-more"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}

function ActivityItem({ activity, index }) {
  const avatarUrl = activity.user.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(activity.user.displayName || activity.user.username)}&background=E07A5F&color=fff`

  const timeAgo = formatDistanceToNow(new Date(activity.createdAt))

  return (
    <motion.div
      className="activity-item"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link to={`/user/${activity.user.username}`} className="activity-item-avatar-link">
        <img
          src={avatarUrl}
          alt={activity.user.displayName || activity.user.username}
          className="activity-item-avatar"
        />
      </Link>

      <div className="activity-item-content">
        <div className="activity-item-header">
          <Link to={`/user/${activity.user.username}`} className="activity-item-user">
            {activity.user.displayName || activity.user.username}
          </Link>
          <span className="activity-item-action">
            shared a {activity.contributionType}
          </span>
          <span className="activity-item-time">{timeAgo}</span>
        </div>

        <div className="activity-item-body">
          <p className="activity-item-text">{activity.content}</p>
        </div>

        <div className="activity-item-footer">
          <span className="activity-item-score">
            {activity.score > 0 ? '+' : ''}{activity.score} helpful
          </span>
        </div>
      </div>
    </motion.div>
  )
}

function ActivityItemSkeleton() {
  return (
    <div className="activity-item activity-item--skeleton">
      <div className="activity-item-avatar skeleton" />
      <div className="activity-item-content">
        <div className="skeleton" style={{ width: '60%', height: '16px', marginBottom: '8px' }} />
        <div className="skeleton" style={{ width: '100%', height: '40px', marginBottom: '8px' }} />
        <div className="skeleton" style={{ width: '80px', height: '14px' }} />
      </div>
    </div>
  )
}
