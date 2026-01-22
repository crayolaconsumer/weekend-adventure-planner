/**
 * UserProfile Page
 *
 * Public profile page for viewing other users
 */

import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserProfile, useFollowers, useFollowing } from '../hooks/useSocial'
import FollowButton from '../components/FollowButton'
import UserCard from '../components/UserCard'
import { ContributionCard } from '../components/ContributionDisplay'
import { formatDate } from '../utils/dateUtils'
import './UserProfile.css'

// Icons
const BackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

const MapPinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21,10c0,7-9,13-9,13S3,17,3,10a9,9,0,0,1,18,0Z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

export default function UserProfile() {
  const { username } = useParams()
  const { profile, loading, error, refresh } = useUserProfile(username)
  const [activeTab, setActiveTab] = useState('contributions')
  const [showFollowersModal, setShowFollowersModal] = useState(false)
  const [showFollowingModal, setShowFollowingModal] = useState(false)

  // Handle follow changes
  const handleFollowChange = useCallback(() => {
    refresh()
  }, [refresh])

  if (loading) {
    return <UserProfileSkeleton />
  }

  if (error || !profile) {
    return (
      <div className="page user-profile-page">
        <header className="user-profile-header">
          <Link to="/" className="user-profile-back">
            <BackIcon />
          </Link>
        </header>
        <div className="user-profile-error">
          <div className="user-profile-error-icon">😕</div>
          <h2>User not found</h2>
          <p>This user doesn't exist or has been removed.</p>
          <Link to="/" className="user-profile-error-link">Go back home</Link>
        </div>
      </div>
    )
  }

  const { user, stats, contributions, isFollowing, isOwnProfile } = profile

  const avatarUrl = user.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.username)}&background=E07A5F&color=fff&size=200`

  return (
    <div className="page user-profile-page">
      {/* Header */}
      <header className="user-profile-header">
        <Link to="/" className="user-profile-back">
          <BackIcon />
        </Link>
        <h1 className="user-profile-header-title">@{user.username}</h1>
        {isOwnProfile && (
          <Link to="/profile" className="user-profile-edit">Edit</Link>
        )}
      </header>

      {/* Profile card */}
      <motion.section
        className="user-profile-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <img
          src={avatarUrl}
          alt={user.displayName || user.username}
          className="user-profile-avatar"
        />

        <div className="user-profile-info">
          <h2 className="user-profile-name">
            {user.displayName || user.username}
          </h2>
          <p className="user-profile-username">@{user.username}</p>

          <div className="user-profile-meta">
            <span className="user-profile-meta-item">
              <CalendarIcon />
              Joined {formatDate(new Date(user.joinedAt))}
            </span>
          </div>
        </div>

        {!isOwnProfile && (
          <div className="user-profile-actions">
            <FollowButton
              userId={user.id}
              initialIsFollowing={isFollowing}
              onFollowChange={handleFollowChange}
              size="large"
            />
          </div>
        )}
      </motion.section>

      {/* Stats */}
      <motion.section
        className="user-profile-stats"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <button
          className="user-profile-stat"
          onClick={() => setShowFollowersModal(true)}
        >
          <span className="user-profile-stat-value">{stats.followers}</span>
          <span className="user-profile-stat-label">Followers</span>
        </button>

        <button
          className="user-profile-stat"
          onClick={() => setShowFollowingModal(true)}
        >
          <span className="user-profile-stat-value">{stats.following}</span>
          <span className="user-profile-stat-label">Following</span>
        </button>

        <div className="user-profile-stat">
          <span className="user-profile-stat-value">{stats.contributions}</span>
          <span className="user-profile-stat-label">Tips</span>
        </div>

        <div className="user-profile-stat">
          <span className="user-profile-stat-value">{stats.helpfulVotes}</span>
          <span className="user-profile-stat-label">Helpful</span>
        </div>
      </motion.section>

      {/* Tabs */}
      <div className="user-profile-tabs" role="tablist" aria-label="Profile sections">
        <button
          className={`user-profile-tab ${activeTab === 'contributions' ? 'active' : ''}`}
          onClick={() => setActiveTab('contributions')}
          role="tab"
          aria-selected={activeTab === 'contributions'}
          aria-controls="profile-contributions-panel"
          id="profile-tab-contributions"
        >
          Tips ({stats.contributions})
        </button>
        <button
          className={`user-profile-tab ${activeTab === 'saves' ? 'active' : ''}`}
          onClick={() => setActiveTab('saves')}
          role="tab"
          aria-selected={activeTab === 'saves'}
          aria-controls="profile-saves-panel"
          id="profile-tab-saves"
        >
          <MapPinIcon />
          Saves ({stats.savedPlaces})
        </button>
      </div>

      {/* Tab content */}
      <motion.section
        className="user-profile-content"
        role="tabpanel"
        id={activeTab === 'contributions' ? 'profile-contributions-panel' : 'profile-saves-panel'}
        aria-labelledby={activeTab === 'contributions' ? 'profile-tab-contributions' : 'profile-tab-saves'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {activeTab === 'contributions' && (
          <div className="user-profile-contributions">
            {contributions.length === 0 ? (
              <div className="user-profile-empty">
                <span className="user-profile-empty-icon">💭</span>
                <p>No tips shared yet</p>
              </div>
            ) : (
              contributions.map(contribution => (
                <ContributionCard
                  key={contribution.id}
                  contribution={{
                    ...contribution,
                    user: {
                      id: user.id,
                      username: user.username,
                      displayName: user.displayName,
                      avatarUrl: user.avatarUrl
                    }
                  }}
                  showUser={false}
                />
              ))
            )}
          </div>
        )}

        {activeTab === 'saves' && (
          <div className="user-profile-saves">
            <div className="user-profile-empty">
              <span className="user-profile-empty-icon">🔒</span>
              <p>Saved places are private</p>
            </div>
          </div>
        )}
      </motion.section>

      {/* Followers Modal */}
      <AnimatePresence>
        {showFollowersModal && (
          <FollowersModal
            userId={user.id}
            onClose={() => setShowFollowersModal(false)}
          />
        )}
      </AnimatePresence>

      {/* Following Modal */}
      <AnimatePresence>
        {showFollowingModal && (
          <FollowingModal
            userId={user.id}
            onClose={() => setShowFollowingModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Followers Modal
 */
function FollowersModal({ userId, onClose }) {
  const { followers, loading, hasMore, loadMore } = useFollowers(userId)

  return (
    <motion.div
      className="user-profile-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="user-profile-modal"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="user-profile-modal-header">
          <h3>Followers</h3>
          <button className="user-profile-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="user-profile-modal-content">
          {loading && followers.length === 0 ? (
            <div className="user-profile-modal-loading">Loading...</div>
          ) : followers.length === 0 ? (
            <div className="user-profile-modal-empty">No followers yet</div>
          ) : (
            <>
              <div className="user-card-list">
                {followers.map(follower => (
                  <UserCard
                    key={follower.id}
                    user={follower}
                    compact
                    showReason={false}
                  />
                ))}
              </div>
              {hasMore && (
                <button
                  className="user-profile-modal-load-more"
                  onClick={loadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Following Modal
 */
function FollowingModal({ userId, onClose }) {
  const { following, loading, hasMore, loadMore } = useFollowing(userId)

  return (
    <motion.div
      className="user-profile-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="user-profile-modal"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="user-profile-modal-header">
          <h3>Following</h3>
          <button className="user-profile-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="user-profile-modal-content">
          {loading && following.length === 0 ? (
            <div className="user-profile-modal-loading">Loading...</div>
          ) : following.length === 0 ? (
            <div className="user-profile-modal-empty">Not following anyone yet</div>
          ) : (
            <>
              <div className="user-card-list">
                {following.map(user => (
                  <UserCard
                    key={user.id}
                    user={user}
                    compact
                    showReason={false}
                  />
                ))}
              </div>
              {hasMore && (
                <button
                  className="user-profile-modal-load-more"
                  onClick={loadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Loading skeleton
 */
function UserProfileSkeleton() {
  return (
    <div className="page user-profile-page">
      <header className="user-profile-header">
        <Link to="/" className="user-profile-back">
          <BackIcon />
        </Link>
      </header>

      <div className="user-profile-card">
        <div className="user-profile-avatar skeleton" />
        <div className="user-profile-info">
          <div className="skeleton" style={{ width: '150px', height: '24px', marginBottom: '8px' }} />
          <div className="skeleton" style={{ width: '100px', height: '16px' }} />
        </div>
      </div>

      <div className="user-profile-stats">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="user-profile-stat">
            <div className="skeleton" style={{ width: '40px', height: '24px', marginBottom: '4px' }} />
            <div className="skeleton" style={{ width: '60px', height: '14px' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
