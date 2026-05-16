/**
 * ContributionDisplay Component
 *
 * Shows the top contribution on a place card.
 * Compact view for card, expandable for detail view.
 */

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useVote } from '../hooks/useContributions'
import ModerationMenu from './ModerationMenu'
import Avatar from './Avatar'
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

// Verified badge icon for trusted explorers
const VerifiedIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="verified-icon">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
  </svg>
)

/**
 * Compact contribution display for cards
 * @param {Object} contribution - The contribution object
 * @param {Function} onClick - Click handler
 * @param {string} variant - 'default' or 'compact' (for swipe cards)
 */
export function ContributionBadge({ contribution, onClick, variant = 'default' }) {
  if (!contribution) return null

  const isTrusted = contribution.user?.isTrusted
  const maxLength = variant === 'compact' ? 50 : 60

  return (
    <motion.button
      className={`contribution-badge ${variant === 'compact' ? 'contribution-badge-compact' : ''}`}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="contribution-badge-quote">"</span>
      <span className="contribution-badge-text">
        {contribution.content.length > maxLength
          ? contribution.content.slice(0, maxLength - 3) + '...'
          : contribution.content}
      </span>
      <span className="contribution-badge-meta">
        — @{contribution.user?.username || 'user'}
        {isTrusted && (
          <span className="contribution-badge-trusted" title="Trusted Explorer">
            <VerifiedIcon />
          </span>
        )}
        {contribution.score > 0 && <span className="contribution-badge-score"> · ↑{contribution.score}</span>}
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
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'register' } }))
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
          <Avatar user={localContribution.user} size={36} className="contribution-avatar" alt="" />
          <div>
            <span className="contribution-username">
              @{localContribution.user.username || 'user'}
            </span>
            <span className="contribution-date">
              {formatDate(localContribution.createdAt)}
            </span>
          </div>
        </div>
        <ModerationMenu
          entityType="contribution"
          entityId={localContribution.id}
          entityLabel={localContribution.contribution_type === 'photo' ? 'this photo' : 'this tip'}
          authorId={localContribution.user?.id}
          authorUsername={localContribution.user?.username}
        />
      </div>

      {/* Photo contributions: render the uploaded image. The URL lives
          on metadata.photoUrl since the upload flow stashes it there
          when the contribution is type=photo. Without this branch the
          photo never displayed and the card just showed empty body
          text. */}
      {localContribution.type === 'photo' && localContribution.metadata?.photoUrl && (
        <img
          src={localContribution.metadata.photoUrl}
          alt={localContribution.content || 'Place photo'}
          className="contribution-card-photo"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}

      {localContribution.content && (
        <p className="contribution-card-content">{localContribution.content}</p>
      )}

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

// Helper — pretty thumb badge for "Recommended" / "Not recommended"
// derived from the rating value.
function recommendationLabel(rating) {
  if (rating == null) return null
  return rating > 3 ? 'Recommended' : 'Not recommended'
}

/**
 * Unified per-user feedback card.
 *
 * Merges every interaction a single user has had with the place — a
 * rating + review, any tip-type contributions, any photo-type
 * contributions — into one visual block. Replaces the old behaviour
 * where each row from `place_ratings` + each row from `contributions`
 * was rendered as its own card, which made a user who left a review
 * AND a photo look like two different visitors.
 */
export function UserFeedbackCard({ entries, onVoteChange }) {
  const { isAuthenticated } = useAuth()
  const { vote } = useVote()

  // Hooks must run in a stable order on every render; compute
  // derived data via useMemo and keep early-return below the hooks.
  // safeEntries is wrapped in useMemo so the dependency arrays on the
  // downstream useMemo for votableEntries doesn't see a new identity
  // every render.
  const safeEntries = useMemo(
    () => (Array.isArray(entries) ? entries : []),
    [entries]
  )
  const user = safeEntries[0]?.user
  const reviewEntry = safeEntries.find(e => e.type === 'review')
  const photos = safeEntries.filter(e => e.type === 'photo')
  const tips = safeEntries.filter(e => e.type === 'tip')
  const votableEntries = useMemo(
    () => safeEntries.filter(e => e.type !== 'review'),
    [safeEntries]
  )

  // Track per-entry vote state so the upvote-button toggle on a photo
  // or tip can update without unmounting the rest of the card.
  const [localEntries, setLocalEntries] = useState(votableEntries)
  // Sync when the server-side entries identity changes (after a vote
  // round-trip, after a moderation action).
  const votableEntriesKey = votableEntries.map(e => e.id).join(',')
  useEffect(() => {
    setLocalEntries(votableEntries)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by stable id concat
  }, [votableEntriesKey])

  // Combined score across this user's votable contributions on this
  // place — gives a single "helpful" count at the bottom of the card.
  const totalScore = localEntries.reduce((acc, e) => acc + (e.score || 0), 0)
  const userVote = localEntries.find(e => e.userVote)?.userVote || null

  const handleCardVote = async (voteType) => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'register' } }))
      return
    }
    if (localEntries.length === 0) return
    // Apply the vote to the first votable entry (typically a tip or a
    // photo). Optimistically update the local state, then sync.
    const target = localEntries[0]
    const newVoteType = target.userVote === voteType ? null : voteType
    setLocalEntries(prev => prev.map((e, i) => {
      if (i !== 0) return e
      let up = e.upvotes, down = e.downvotes
      if (e.userVote === 'up') up--
      if (e.userVote === 'down') down--
      if (newVoteType === 'up') up++
      if (newVoteType === 'down') down++
      return { ...e, upvotes: up, downvotes: down, score: up - down, userVote: newVoteType }
    }))
    const result = await vote(target.id, newVoteType)
    if (result?.success) {
      setLocalEntries(prev => prev.map((e, i) => i === 0 ? {
        ...e,
        upvotes: result.upvotes,
        downvotes: result.downvotes,
        score: result.upvotes - result.downvotes,
        userVote: result.userVote,
      } : e))
      onVoteChange?.(result)
    } else {
      setLocalEntries(votableEntries)
    }
  }

  // Choose the most recent timestamp across the group so the date
  // line reflects the user's latest interaction with this place.
  const latestTs = entries.reduce((latest, e) => {
    const t = new Date(e.createdAt).getTime()
    return Number.isFinite(t) && t > latest ? t : latest
  }, 0)
  const formatDate = (ts) => {
    if (!ts) return ''
    const date = new Date(ts)
    const now = new Date()
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
    return `${Math.floor(diffDays / 365)}y ago`
  }

  // The "default" placeholder content the older photo-upload flow
  // saved when the user uploaded an image without writing a caption.
  // Don't render it — it's noise. New uploads no longer save this
  // string but historical rows still have it.
  const isPlaceholderCaption = (s) => s === 'Photo contribution'

  const recBadge = recommendationLabel(reviewEntry?.rating)

  // Pick a stable React key from the highest-id votable entry, or the
  // review id, or fall back to user id.
  const cardKey = localEntries[0]?.id || reviewEntry?.id || `u_${user?.id}`

  // Early-return AFTER all hooks have run so React's hook order stays
  // consistent across renders (the rules-of-hooks lint will flag any
  // early-return before hook calls).
  if (safeEntries.length === 0) return null

  return (
    <div className="contribution-card user-feedback-card" data-card-key={cardKey}>
      <div className="contribution-card-header">
        <div className="contribution-card-user">
          <Avatar user={user} size={36} className="contribution-avatar" alt="" />
          <div>
            <span className="contribution-username">
              @{user?.username || 'user'}
            </span>
            <span className="contribution-date">{formatDate(latestTs)}</span>
          </div>
        </div>
        {/* Moderation menu hooks to whichever entry the user is
            actually viewing — prefer the review (covers the bulk of
            what's being moderated) and fall back to the first
            votable entry. */}
        {(reviewEntry || localEntries[0]) && (
          <ModerationMenu
            entityType={reviewEntry ? 'review' : 'contribution'}
            entityId={(reviewEntry || localEntries[0]).id}
            entityLabel={reviewEntry ? 'this review' : (photos.length ? 'this photo' : 'this tip')}
            authorId={user?.id}
            authorUsername={user?.username}
          />
        )}
      </div>

      {recBadge && (
        <div className={`user-feedback-recommendation ${reviewEntry.rating > 3 ? 'positive' : 'negative'}`}>
          <span>{recBadge}</span>
        </div>
      )}

      {reviewEntry?.content && (
        <p className="user-feedback-review">&ldquo;{reviewEntry.content}&rdquo;</p>
      )}

      {tips.map(t => (
        !isPlaceholderCaption(t.content) && t.content && (
          <p key={t.id} className="contribution-card-content">{t.content}</p>
        )
      ))}

      {photos.length > 0 && (
        <div className="user-feedback-photos">
          {photos.map(p => (
            <div key={p.id} className="user-feedback-photo">
              {p.metadata?.photoUrl && (
                <img
                  src={p.metadata.photoUrl}
                  alt={p.content && !isPlaceholderCaption(p.content) ? p.content : 'Place photo'}
                  className="contribution-card-photo"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
              {p.content && !isPlaceholderCaption(p.content) && (
                <p className="contribution-card-content">{p.content}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {localEntries.length > 0 && (
        <div className="contribution-card-footer">
          <div className="contribution-votes">
            <button
              className={`vote-btn upvote ${userVote === 'up' ? 'active' : ''}`}
              onClick={() => handleCardVote('up')}
              aria-label="Upvote"
            >
              <UpvoteIcon filled={userVote === 'up'} />
              <span>{localEntries[0].upvotes}</span>
            </button>
            <button
              className={`vote-btn downvote ${userVote === 'down' ? 'active' : ''}`}
              onClick={() => handleCardVote('down')}
              aria-label="Downvote"
            >
              <DownvoteIcon filled={userVote === 'down'} />
              <span>{localEntries[0].downvotes}</span>
            </button>
          </div>
          <span className="contribution-score">
            {totalScore > 0 ? '+' : ''}{totalScore} helpful
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * List of contributions for a place
 */
export function ContributionList({ contributions, loading, emptyMessage }) {
  if (loading) {
    return (
      <div className="contributions-loading" role="status" aria-live="polite">
        {/* Skeleton placeholders matching the shape of a contribution
            card — avatar circle + 2 lines of text. Uses the same
            theme-aware shimmer as ActivityItemSkeleton so the loading
            idiom is consistent across the app. */}
        {[0, 1, 2].map(i => (
          <div key={i} className="contribution-skeleton">
            <div className="contribution-skeleton-avatar" />
            <div className="contribution-skeleton-lines">
              <div className="contribution-skeleton-line" style={{ width: '40%' }} />
              <div className="contribution-skeleton-line" style={{ width: '95%' }} />
              <div className="contribution-skeleton-line" style={{ width: '70%' }} />
            </div>
          </div>
        ))}
        <span className="visually-hidden">Loading tips</span>
      </div>
    )
  }

  if (!contributions || contributions.length === 0) {
    return (
      <div className="contributions-empty">
        <p>{emptyMessage || 'No tips yet. Be the first to share!'}</p>
      </div>
    )
  }

  // Group entries by user so a single user's rating + review + tip(s)
  // + photo(s) on this place collapse into ONE visual card. The old
  // flat render exposed each row from `place_ratings` (reviews) and
  // each row from `contributions` (tips/photos) as a separate visitor,
  // which made a single reviewer who also uploaded a photo look like
  // two different users.
  const groupsByUser = new Map()
  for (const entry of contributions) {
    const uid = entry.user?.id ?? `anon_${entry.id}`
    if (!groupsByUser.has(uid)) groupsByUser.set(uid, [])
    groupsByUser.get(uid).push(entry)
  }
  // Stable order: newest interaction (max createdAt) per user first.
  const ordered = Array.from(groupsByUser.entries())
    .map(([uid, entries]) => ({
      uid,
      entries,
      latestTs: Math.max(...entries.map(e => new Date(e.createdAt).getTime() || 0)),
    }))
    .sort((a, b) => b.latestTs - a.latestTs)

  return (
    <div className="contributions-list">
      <AnimatePresence>
        {ordered.map(({ uid, entries }, index) => (
          <motion.div
            key={uid}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <UserFeedbackCard entries={entries} />
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
