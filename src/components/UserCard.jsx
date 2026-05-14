/**
 * UserCard Component
 *
 * Display user info in a card format for lists
 */

import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import FollowButton from './FollowButton'
import { formatDisplayName } from '../utils/displayName'
import PremiumBadge from './PremiumBadge'
import ModerationMenu from './ModerationMenu'
import './UserCard.css'

export default function UserCard({
  user,
  showFollowButton = true,
  showStats = false,
  showReason = true,
  compact = false
}) {
  const [followerCount, setFollowerCount] = useState(user.followerCount || 0)
  const [isFollowing, setIsFollowing] = useState(user.isFollowing || false)
  // Forward server's "followStatus" when available (e.g. set to 'requested'
  // if a pending follow request already exists) so the button doesn't
  // reset to "Follow" between renders. Falls back to isFollowing if the
  // calling endpoint doesn't provide a status.
  const [followStatus, setFollowStatus] = useState(
    user.followStatus || (user.isFollowing ? 'following' : 'not_following')
  )

  const handleFollowChange = useCallback((newCount, nowFollowing, newStatus) => {
    setFollowerCount(newCount)
    setIsFollowing(nowFollowing)
    if (newStatus) setFollowStatus(newStatus)
  }, [])

  const avatarUrl = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(formatDisplayName(user))}&background=E07A5F&color=fff`

  return (
    <motion.div
      className={`user-card ${compact ? 'user-card--compact' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
    >
      <Link to={`/user/${user.username}`} className="user-card-link">
        <span className="avatar-with-premium">
          <img
            src={avatarUrl}
            alt={formatDisplayName(user)}
            className="user-card-avatar"
            onError={(e) => {
              if (!e.currentTarget.dataset.fallback) {
                e.currentTarget.dataset.fallback = '1'
                e.currentTarget.src = '/icons/icon-192.png'
              }
            }}
          />
          {user.isPremium && <PremiumBadge size="sm" />}
        </span>

        <div className="user-card-info">
          <div className="user-card-name">
            {formatDisplayName(user)}
          </div>
          <div className="user-card-username">@{user.username}</div>

          {showStats && (
            <div className="user-card-stats">
              {user.contributionCount !== undefined && (
                <span>{user.contributionCount} tips</span>
              )}
              {followerCount > 0 && (
                <span>{followerCount} followers</span>
              )}
            </div>
          )}

          {showReason && user.matchReason && (
            <div className="user-card-reason">{user.matchReason}</div>
          )}
        </div>
      </Link>

      {showFollowButton && (
        <div className="user-card-action">
          <FollowButton
            userId={user.id}
            initialIsFollowing={isFollowing}
            initialFollowStatus={followStatus}
            isPrivateAccount={!!user.isPrivate}
            onFollowChange={handleFollowChange}
            size="small"
          />
          <ModerationMenu
            entityType="user"
            entityId={user.id}
            entityLabel={`@${user.username}`}
            authorId={user.id}
            authorUsername={user.username}
          />
        </div>
      )}
    </motion.div>
  )
}

/**
 * UserCardSkeleton - Loading placeholder
 */
export function UserCardSkeleton({ compact = false }) {
  return (
    <div className={`user-card user-card--skeleton ${compact ? 'user-card--compact' : ''}`}>
      <div className="user-card-avatar skeleton" />
      <div className="user-card-info">
        <div className="user-card-name skeleton" style={{ width: '120px', height: '16px' }} />
        <div className="user-card-username skeleton" style={{ width: '80px', height: '14px' }} />
      </div>
      <div className="user-card-action">
        <div className="skeleton" style={{ width: '80px', height: '32px', borderRadius: '16px' }} />
      </div>
    </div>
  )
}
