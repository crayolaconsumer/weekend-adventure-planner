/**
 * FollowButton Component
 *
 * Button to follow/unfollow users with optimistic updates
 */

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useFollow } from '../hooks/useSocial'
import './FollowButton.css'

export default function FollowButton({
  userId,
  initialIsFollowing = false,
  onFollowChange,
  size = 'medium',
  variant = 'primary'
}) {
  const { isAuthenticated, user } = useAuth()
  const { follow, unfollow, loading } = useFollow()
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)

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

    // Optimistic update
    const wasFollowing = isFollowing
    setIsFollowing(!wasFollowing)

    const result = wasFollowing
      ? await unfollow(userId)
      : await follow(userId)

    if (!result.success) {
      // Revert on error
      setIsFollowing(wasFollowing)
    } else {
      onFollowChange?.(result.followerCount, !wasFollowing)
    }
  }, [isAuthenticated, isFollowing, userId, follow, unfollow, onFollowChange])

  // Don't show button for own profile
  if (isOwnProfile) {
    return null
  }

  return (
    <div className="follow-button-wrapper">
      <motion.button
        className={`follow-button follow-button--${size} follow-button--${variant} ${isFollowing ? 'following' : ''}`}
        onClick={handleClick}
        disabled={loading}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {loading ? (
          <span className="follow-button-spinner" />
        ) : isFollowing ? (
          <>
            <CheckIcon />
            <span>Following</span>
          </>
        ) : (
          <>
            <PlusIcon />
            <span>Follow</span>
          </>
        )}
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
