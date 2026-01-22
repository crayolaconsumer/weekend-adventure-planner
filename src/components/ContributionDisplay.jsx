/**
 * ContributionDisplay Component
 *
 * Shows the top contribution on a place card.
 * Compact view for card, expandable for detail view.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useVote } from '../hooks/useContributions'
import './ContributionDisplay.css'

// Upvote icon
const UpvoteIcon = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)

// Downvote icon
const DownvoteIcon = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12l7 7 7-7" />
  </svg>
)

/**
 * Compact contribution display for cards
 */
export function ContributionBadge({ contribution, onClick }) {
  if (!contribution) return null

  return (
    <motion.button
      className="contribution-badge"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="contribution-badge-quote">"</span>
      <span className="contribution-badge-text">
        {contribution.content.length > 60
          ? contribution.content.slice(0, 57) + '...'
          : contribution.content}
      </span>
      <span className="contribution-badge-meta">
        — @{contribution.user.username || 'user'} · ↑{contribution.score}
      </span>
    </motion.button>
  )
}

/**
 * Full contribution card with voting
 */
export function ContributionCard({ contribution, onVoteChange }) {
  const { isAuthenticated } = useAuth()
  const { vote, loading: voteLoading } = useVote()
  const [localContribution, setLocalContribution] = useState(contribution)

  useEffect(() => {
    setLocalContribution(contribution)
  }, [contribution])

  const handleVote = async (voteType) => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal'))
      return
    }

    // Optimistic update
    const currentVote = localContribution.userVote
    const newVoteType = currentVote === voteType ? null : voteType

    let newUpvotes = localContribution.upvotes
    let newDownvotes = localContribution.downvotes

    // Remove old vote
    if (currentVote === 'up') newUpvotes--
    if (currentVote === 'down') newDownvotes--

    // Add new vote
    if (newVoteType === 'up') newUpvotes++
    if (newVoteType === 'down') newDownvotes++

    setLocalContribution({
      ...localContribution,
      upvotes: newUpvotes,
      downvotes: newDownvotes,
      score: newUpvotes - newDownvotes,
      userVote: newVoteType
    })

    const result = await vote(contribution.id, newVoteType)

    if (result.success) {
      setLocalContribution(prev => ({
        ...prev,
        upvotes: result.upvotes,
        downvotes: result.downvotes,
        score: result.upvotes - result.downvotes,
        userVote: result.userVote
      }))
      onVoteChange?.(result)
    } else {
      // Revert on error
      setLocalContribution(contribution)
    }
  }

  const formatDate = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
    return `${Math.floor(diffDays / 365)}y ago`
  }

  return (
    <div className="contribution-card">
      <div className="contribution-card-header">
        <div className="contribution-card-user">
          {localContribution.user.avatarUrl ? (
            <img
              src={localContribution.user.avatarUrl}
              alt=""
              className="contribution-avatar"
            />
          ) : (
            <div className="contribution-avatar-placeholder">
              {(localContribution.user.displayName || localContribution.user.username || 'U')[0].toUpperCase()}
            </div>
          )}
          <div>
            <span className="contribution-username">
              @{localContribution.user.username || 'user'}
            </span>
            <span className="contribution-date">
              {formatDate(localContribution.createdAt)}
            </span>
          </div>
        </div>
      </div>

      <p className="contribution-card-content">{localContribution.content}</p>

      <div className="contribution-card-footer">
        <div className="contribution-votes">
          <button
            className={`vote-btn upvote ${localContribution.userVote === 'up' ? 'active' : ''}`}
            onClick={() => handleVote('up')}
            disabled={voteLoading}
            aria-label="Upvote"
          >
            <UpvoteIcon filled={localContribution.userVote === 'up'} />
            <span>{localContribution.upvotes}</span>
          </button>

          <button
            className={`vote-btn downvote ${localContribution.userVote === 'down' ? 'active' : ''}`}
            onClick={() => handleVote('down')}
            disabled={voteLoading}
            aria-label="Downvote"
          >
            <DownvoteIcon filled={localContribution.userVote === 'down'} />
            <span>{localContribution.downvotes}</span>
          </button>
        </div>

        <span className="contribution-score">
          {localContribution.score > 0 ? '+' : ''}{localContribution.score} helpful
        </span>
      </div>
    </div>
  )
}

/**
 * List of contributions for a place
 */
export function ContributionList({ contributions, loading, emptyMessage }) {
  if (loading) {
    return (
      <div className="contributions-loading">
        <div className="contributions-loading-spinner" />
        <span>Loading tips...</span>
      </div>
    )
  }

  if (!contributions || contributions.length === 0) {
    return (
      <div className="contributions-empty">
        <span className="contributions-empty-icon">💡</span>
        <p>{emptyMessage || 'No tips yet. Be the first to share!'}</p>
      </div>
    )
  }

  return (
    <div className="contributions-list">
      <AnimatePresence>
        {contributions.map((contribution, index) => (
          <motion.div
            key={contribution.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <ContributionCard contribution={contribution} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export default {
  ContributionBadge,
  ContributionCard,
  ContributionList
}
