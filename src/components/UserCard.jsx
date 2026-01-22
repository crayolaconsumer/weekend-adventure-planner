/**
 * UserCard Component
 *
 * Display user info in a card format for lists
 */

import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import FollowButton from './FollowButton'
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

  const handleFollowChange = useCallback((newCount, nowFollowing) => {
    setFollowerCount(newCount)
    setIsFollowing(nowFollowing)
  }, [])

  const avatarUrl = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.username)}&background=E07A5F&color=fff`

  return (
    <motion.div
      className={`user-card ${compact ? 'user-card--compact' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
    >
      <Link to={`/user/${user.username}`} className="user-card-link">
        <img
          src={avatarUrl}
          alt={user.displayName || user.username}
          className="user-card-avatar"
        />

        <div className="user-card-info">
          <div className="user-card-name">
            {user.displayName || user.username}
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
            onFollowChange={handleFollowChange}
            size="small"
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
