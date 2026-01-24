/**
 * FollowButton Component
 *
 * Button to follow/unfollow users with optimistic updates
 * Handles private accounts with follow request flow
 */

import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useFollow } from '../hooks/useSocial'
import './FollowButton.css'

export default function FollowButton({
  userId,
  initialIsFollowing = false,
  initialFollowStatus = null, // 'following', 'requested', 'not_following'
  isPrivateAccount = false,
  onFollowChange,
  size = 'medium',
  variant = 'primary'
}) {
  const { isAuthenticated, user } = useAuth()
  const { follow, unfollow, loading } = useFollow()

  // Determine initial state from either prop
  const getInitialStatus = () => {
    if (initialFollowStatus) return initialFollowStatus
    return initialIsFollowing ? 'following' : 'not_following'
  }

  const [followStatus, setFollowStatus] = useState(getInitialStatus)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)

  // Update state if props change
  useEffect(() => {
    if (initialFollowStatus) {
      setFollowStatus(initialFollowStatus)
    } else {
      setFollowStatus(initialIsFollowing ? 'following' : 'not_following')
    }
  }, [initialIsFollowing, initialFollowStatus])

  // Check if this is the user's own profile
  const isOwnProfile = user && user.id === userId

  const handleClick = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (!isAuthenticated) {
      setShowAuthPrompt(true)
      setTimeout(() => setShowAuthPrompt(false), 3000)
      return
    }

    // Current status before action
    const currentStatus = followStatus

    // Optimistic update based on current status
    if (currentStatus === 'following' || currentStatus === 'requested') {
      // Unfollow or cancel request
      setFollowStatus('not_following')
      const result = await unfollow(userId)

      if (!result.success) {
        // Revert on error
        setFollowStatus(currentStatus)
      } else {
        onFollowChange?.(result.followerCount, false, result.status || 'not_following')
      }
    } else {
      // Follow or request to follow
      // Optimistic: if private, show requested; else show following
      setFollowStatus(isPrivateAccount ? 'requested' : 'following')

      const result = await follow(userId)

      if (!result.success) {
        // Revert on error
        setFollowStatus(currentStatus)
      } else {
        // Use server's returned status
        const newStatus = result.status || (isPrivateAccount ? 'requested' : 'following')
        setFollowStatus(newStatus)
        onFollowChange?.(result.followerCount, newStatus === 'following', newStatus)
      }
    }
  }, [isAuthenticated, followStatus, userId, follow, unfollow, onFollowChange, isPrivateAccount])

  // Don't show button for own profile
  if (isOwnProfile) {
    return null
  }

  const getButtonContent = () => {
    if (loading) {
      return <span className="follow-button-spinner" />
    }

    switch (followStatus) {
      case 'following':
        return (
          <>
            <CheckIcon />
            <span>Following</span>
          </>
        )
      case 'requested':
        return (
          <>
            <ClockIcon />
            <span>Requested</span>
          </>
        )
      default:
        return (
          <>
            <PlusIcon />
            <span>{isPrivateAccount ? 'Request' : 'Follow'}</span>
          </>
        )
    }
  }

  const buttonClasses = [
    'follow-button',
    `follow-button--${size}`,
    `follow-button--${variant}`,
    followStatus === 'following' ? 'following' : '',
    followStatus === 'requested' ? 'requested' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className="follow-button-wrapper">
      <motion.button
        className={buttonClasses}
        onClick={handleClick}
        disabled={loading}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {getButtonContent()}
      </motion.button>

      {showAuthPrompt && (
        <motion.div
          className="follow-auth-prompt"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          Sign in to follow users
        </motion.div>
      )}
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
