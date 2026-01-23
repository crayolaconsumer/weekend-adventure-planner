/**
 * UnifiedProfile Page
 *
 * Merged profile page combining:
 * - Profile.jsx (Your Journey) - gamification, badges, personal stats
 * - UserProfile.jsx - public profile, social features, contributions
 *
 * Tabs: Activity | Journey | Settings (owner only)
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { useUserProfile, useFollowers, useFollowing } from '../hooks/useSocial'
import { useUserContributions } from '../hooks/useContributions'
import { getVisitedPlaces } from '../utils/statsUtils'
import FollowButton from '../components/FollowButton'
import UserCard from '../components/UserCard'
import { ContributionCard } from '../components/ContributionDisplay'
import CategoryChart from '../components/stats/CategoryChart'
import DistanceStats from '../components/stats/DistanceStats'
import MonthlyTrends from '../components/stats/MonthlyTrends'
import VisitedMap from '../components/stats/VisitedMap'
import { formatDate } from '../utils/dateUtils'
import './UnifiedProfile.css'

// Icons
const BackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
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

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const LogOutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
)

// Badge definitions
const BADGES = [
  { id: 'first_adventure', name: 'First Steps', icon: '🌱', description: 'Completed your first adventure', requirement: (s) => s.timesWentOut >= 1 },
  { id: 'explorer_5', name: 'Explorer', icon: '🧭', description: 'Visited 5 places', requirement: (s) => s.timesWentOut >= 5 },
  { id: 'explorer_25', name: 'Pathfinder', icon: '🗺️', description: 'Visited 25 places', requirement: (s) => s.timesWentOut >= 25 },
  { id: 'explorer_100', name: 'Wanderer', icon: '🌍', description: 'Visited 100 places', requirement: (s) => s.timesWentOut >= 100 },
  { id: 'streak_3', name: 'Getting Into It', icon: '🔥', description: '3 day streak', requirement: (s) => s.bestStreak >= 3 },
  { id: 'streak_7', name: 'Week Warrior', icon: '⚡', description: '7 day streak', requirement: (s) => s.bestStreak >= 7 },
  { id: 'streak_30', name: 'Unstoppable', icon: '💪', description: '30 day streak', requirement: (s) => s.bestStreak >= 30 },
  { id: 'boredom_buster', name: 'Spontaneous', icon: '🎲', description: 'Used Boredom Buster 10 times', requirement: (s) => s.boredomBusts >= 10 },
  { id: 'curator', name: 'Curator', icon: '📚', description: 'Saved 20 places to wishlist', requirement: (s) => s.wishlistCount >= 20 },
  { id: 'planner', name: 'Planner', icon: '📋', description: 'Created 5 adventures', requirement: (s) => s.adventuresCreated >= 5 },
]

// Helper to load stats from localStorage
function loadStatsFromStorage() {
  const savedStats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
  const wishlist = JSON.parse(localStorage.getItem('roam_wishlist') || '[]')
  const adventures = JSON.parse(localStorage.getItem('roam_adventures') || '[]')

  const lastActivity = savedStats.lastActivityDate
  let currentStreak = savedStats.currentStreak || 0

  if (lastActivity) {
    const lastDate = new Date(lastActivity)
    const daysDiff = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24))
    if (daysDiff > 1) {
      currentStreak = 0
    }
  }

  return {
    totalSwipes: 0,
    timesWentOut: 0,
    boredomBusts: 0,
    bestStreak: 0,
    lastActivityDate: null,
    ...savedStats,
    currentStreak,
    wishlistCount: wishlist.length,
    adventuresCreated: adventures.length
  }
}

export default function UnifiedProfile() {
  const { username } = useParams()
  const navigate = useNavigate()
  const { user: currentUser, isAuthenticated, loading: authLoading, logout } = useAuth()

  // Determine if this is the user's own profile
  const isOwnProfile = isAuthenticated && currentUser?.username === username

  // Fetch profile data (works for any user)
  const { profile, loading: profileLoading, error, refresh } = useUserProfile(username)

  // For own profile, also load local stats
  const [localStats] = useState(loadStatsFromStorage)
  const [visitedPlaces] = useState(getVisitedPlaces)

  // Own contributions (for owner view)
  const { contributions: ownContributions, loading: contribLoading, refresh: refreshContributions } = useUserContributions(currentUser?.id)

  // Tab state
  const [activeTab, setActiveTab] = useState('activity')

  // Modal states
  const [showFollowersModal, setShowFollowersModal] = useState(false)
  const [showFollowingModal, setShowFollowingModal] = useState(false)

  // Refresh contributions when profile loads
  useEffect(() => {
    if (isOwnProfile && currentUser?.id) {
      refreshContributions()
    }
  }, [isOwnProfile, currentUser?.id, refreshContributions])

  // Handle follow changes
  const handleFollowChange = useCallback(() => {
    refresh()
  }, [refresh])

  // Calculate level (for Journey tab)
  const totalActivity = (localStats.timesWentOut || 0) + (localStats.boredomBusts || 0) + (localStats.adventuresCreated || 0)
  const level = Math.floor(Math.sqrt(totalActivity)) + 1
  const nextLevelRequirement = Math.pow(level, 2)
  const levelProgress = ((totalActivity - Math.pow(level - 1, 2)) / (nextLevelRequirement - Math.pow(level - 1, 2))) * 100

  // Get earned badges
  const earnedBadges = BADGES.filter(badge => badge.requirement(localStats))
  const lockedBadges = BADGES.filter(badge => !badge.requirement(localStats))

  // Loading state
  if (profileLoading || authLoading) {
    return <ProfileSkeleton />
  }

  // Error state
  if (error || !profile) {
    return (
      <div className="page unified-profile-page">
        <header className="unified-profile-header">
          <button onClick={() => navigate(-1)} className="unified-profile-back" aria-label="Go back">
            <BackIcon />
          </button>
        </header>
        <div className="unified-profile-error">
          <div className="unified-profile-error-icon">😕</div>
          <h2>User not found</h2>
          <p>This user doesn't exist or has been removed.</p>
          <Link to="/" className="unified-profile-error-link">Go back home</Link>
        </div>
      </div>
    )
  }

  const { user, stats, contributions, isFollowing } = profile
  const avatarUrl = user.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.username)}&background=E07A5F&color=fff&size=200`

  return (
    <div className="page unified-profile-page">
      {/* Header */}
      <header className="unified-profile-header">
        <button onClick={() => navigate(-1)} className="unified-profile-back" aria-label="Go back">
          <BackIcon />
        </button>
        <h1 className="unified-profile-header-title">@{user.username}</h1>
        {isOwnProfile && (
          <button
            className="unified-profile-settings-btn"
            onClick={() => setActiveTab('settings')}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        )}
      </header>

      {/* Profile Card */}
      <motion.section
        className="unified-profile-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <img
          src={avatarUrl}
          alt={user.displayName || user.username}
          className="unified-profile-avatar"
        />

        <div className="unified-profile-info">
          <h2 className="unified-profile-name">
            {user.displayName || user.username}
          </h2>
          <p className="unified-profile-username">@{user.username}</p>

          {/* Level badge (public) */}
          {isOwnProfile && level > 1 && (
            <span className="unified-profile-level-badge">
              Level {level} Explorer
            </span>
          )}

          <div className="unified-profile-meta">
            <span className="unified-profile-meta-item">
              <CalendarIcon />
              Joined {formatDate(new Date(user.joinedAt))}
            </span>
          </div>
        </div>

        {!isOwnProfile && (
          <div className="unified-profile-actions">
            <FollowButton
              userId={user.id}
              initialIsFollowing={isFollowing}
              onFollowChange={handleFollowChange}
              size="large"
            />
          </div>
        )}
      </motion.section>

      {/* Stats Bar */}
      <motion.section
        className="unified-profile-stats"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <button
          className="unified-profile-stat"
          onClick={() => setShowFollowersModal(true)}
        >
          <span className="unified-profile-stat-value">{stats.followers}</span>
          <span className="unified-profile-stat-label">Followers</span>
        </button>

        <button
          className="unified-profile-stat"
          onClick={() => setShowFollowingModal(true)}
        >
          <span className="unified-profile-stat-value">{stats.following}</span>
          <span className="unified-profile-stat-label">Following</span>
        </button>

        <div className="unified-profile-stat">
          <span className="unified-profile-stat-value">{stats.contributions}</span>
          <span className="unified-profile-stat-label">Tips</span>
        </div>

        <div className="unified-profile-stat">
          <span className="unified-profile-stat-value">{stats.helpfulVotes}</span>
          <span className="unified-profile-stat-label">Helpful</span>
        </div>
      </motion.section>

      {/* Tabs */}
      <div className="unified-profile-tabs" role="tablist" aria-label="Profile sections">
        <button
          className={`unified-profile-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
          role="tab"
          aria-selected={activeTab === 'activity'}
          aria-controls="profile-activity-panel"
        >
          Activity
        </button>
        <button
          className={`unified-profile-tab ${activeTab === 'journey' ? 'active' : ''}`}
          onClick={() => setActiveTab('journey')}
          role="tab"
          aria-selected={activeTab === 'journey'}
          aria-controls="profile-journey-panel"
        >
          Journey
        </button>
        {isOwnProfile && (
          <button
            className={`unified-profile-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            role="tab"
            aria-selected={activeTab === 'settings'}
            aria-controls="profile-settings-panel"
          >
            Settings
          </button>
        )}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'activity' && (
          <motion.section
            key="activity"
            className="unified-profile-content"
            role="tabpanel"
            id="profile-activity-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <ActivityTab
              contributions={isOwnProfile ? ownContributions : contributions}
              loading={isOwnProfile ? contribLoading : false}
              user={user}
              isOwnProfile={isOwnProfile}
            />
          </motion.section>
        )}

        {activeTab === 'journey' && (
          <motion.section
            key="journey"
            className="unified-profile-content"
            role="tabpanel"
            id="profile-journey-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <JourneyTab
              stats={localStats}
              level={level}
              levelProgress={levelProgress}
              nextLevelRequirement={nextLevelRequirement}
              totalActivity={totalActivity}
              earnedBadges={earnedBadges}
              lockedBadges={lockedBadges}
              visitedPlaces={visitedPlaces}
              isOwnProfile={isOwnProfile}
            />
          </motion.section>
        )}

        {activeTab === 'settings' && isOwnProfile && (
          <motion.section
            key="settings"
            className="unified-profile-content"
            role="tabpanel"
            id="profile-settings-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <SettingsTab
              user={currentUser}
              onLogout={logout}
            />
          </motion.section>
        )}
      </AnimatePresence>

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
 * Activity Tab - Tips/Contributions
 */
function ActivityTab({ contributions, loading, user, isOwnProfile }) {
  if (loading) {
    return (
      <div className="unified-profile-loading">
        <div className="unified-profile-spinner" />
        <span>Loading tips...</span>
      </div>
    )
  }

  if (!contributions || contributions.length === 0) {
    return (
      <div className="unified-profile-empty">
        <span className="unified-profile-empty-icon">💭</span>
        <p>{isOwnProfile ? "You haven't shared any tips yet" : "No tips shared yet"}</p>
        {isOwnProfile && (
          <p className="unified-profile-empty-hint">
            Visit a place and share what made it special!
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="unified-profile-contributions">
      {contributions.map(contribution => (
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
      ))}
    </div>
  )
}

/**
 * Journey Tab - Gamification, Badges, Stats
 */
function JourneyTab({ stats, level, levelProgress, nextLevelRequirement, totalActivity, earnedBadges, lockedBadges, visitedPlaces, isOwnProfile }) {
  return (
    <div className="unified-profile-journey">
      {/* Level Card */}
      <motion.div
        className="unified-profile-level-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="unified-profile-level-header">
          <div className="unified-profile-level-badge">
            <span className="unified-profile-level-number">{level}</span>
          </div>
          <div className="unified-profile-level-info">
            <h3 className="unified-profile-level-title">Level {level} Explorer</h3>
            <p className="unified-profile-level-subtitle">
              {nextLevelRequirement - totalActivity} more activities to level up
            </p>
          </div>
        </div>
        <div className="unified-profile-level-progress">
          <div
            className="unified-profile-level-progress-bar"
            style={{ width: `${Math.min(100, levelProgress)}%` }}
          />
        </div>
      </motion.div>

      {/* Stats Grid */}
      <div className="unified-profile-stats-grid">
        <div className="unified-profile-stat-card">
          <span className="unified-profile-stat-card-value">{stats.timesWentOut || 0}</span>
          <span className="unified-profile-stat-card-label">Places Visited</span>
        </div>
        <div className="unified-profile-stat-card">
          <span className="unified-profile-stat-card-value">{stats.currentStreak || 0}</span>
          <span className="unified-profile-stat-card-label">Day Streak</span>
        </div>
        <div className="unified-profile-stat-card">
          <span className="unified-profile-stat-card-value">{stats.boredomBusts || 0}</span>
          <span className="unified-profile-stat-card-label">Boredom Busts</span>
        </div>
        <div className="unified-profile-stat-card">
          <span className="unified-profile-stat-card-value">{stats.wishlistCount || 0}</span>
          <span className="unified-profile-stat-card-label">Saved Places</span>
        </div>
      </div>

      {/* Badges */}
      <div className="unified-profile-badges-section">
        <h3 className="unified-profile-section-title">Badges</h3>

        {earnedBadges.length > 0 && (
          <div className="unified-profile-badges earned">
            {earnedBadges.map((badge, index) => (
              <motion.div
                key={badge.id}
                className="unified-profile-badge"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
              >
                <span className="unified-profile-badge-icon">{badge.icon}</span>
                <span className="unified-profile-badge-name">{badge.name}</span>
                <span className="unified-profile-badge-desc">{badge.description}</span>
              </motion.div>
            ))}
          </div>
        )}

        {isOwnProfile && lockedBadges.length > 0 && (
          <>
            <h4 className="unified-profile-subsection-title">Locked</h4>
            <div className="unified-profile-badges locked">
              {lockedBadges.map(badge => (
                <div key={badge.id} className="unified-profile-badge locked">
                  <span className="unified-profile-badge-icon">🔒</span>
                  <span className="unified-profile-badge-name">{badge.name}</span>
                  <span className="unified-profile-badge-desc">{badge.description}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Visual Stats - Owner Only */}
      {isOwnProfile && visitedPlaces.length > 0 && (
        <div className="unified-profile-viz-section">
          <h3 className="unified-profile-section-title">Your Map</h3>
          <div className="unified-profile-viz-grid">
            <VisitedMap places={visitedPlaces} />
            <CategoryChart places={visitedPlaces} />
          </div>
          <div className="unified-profile-viz-grid">
            <DistanceStats places={visitedPlaces} />
            <MonthlyTrends places={visitedPlaces} />
          </div>
        </div>
      )}

      {/* Best Streak */}
      {stats.bestStreak > 0 && (
        <div className="unified-profile-highlight">
          <span className="unified-profile-highlight-icon">🏆</span>
          <div className="unified-profile-highlight-content">
            <span className="unified-profile-highlight-value">{stats.bestStreak} days</span>
            <span className="unified-profile-highlight-label">Best Streak</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Settings Tab - Account Management
 */
function SettingsTab({ user, onLogout }) {
  const { isPremium, manageSubscription, loading } = useSubscription()

  return (
    <div className="unified-profile-settings">
      {/* Premium Section */}
      {!isPremium ? (
        <div className="unified-profile-settings-section premium-upgrade-section">
          <Link to="/pricing" className="profile-upgrade-btn">
            <span className="upgrade-sparkle">✨</span>
            <span className="upgrade-text">Upgrade to ROAM+</span>
            <span className="upgrade-badge">7 days free</span>
          </Link>
        </div>
      ) : (
        <div className="unified-profile-settings-section">
          <h3 className="unified-profile-settings-title">Subscription</h3>
          <button
            className="unified-profile-settings-item clickable"
            onClick={manageSubscription}
            disabled={loading}
          >
            <span className="unified-profile-settings-label">ROAM+ Premium</span>
            <span className="unified-profile-settings-value">
              {loading ? 'Loading...' : 'Manage →'}
            </span>
          </button>
        </div>
      )}

      {/* Account Info */}
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Account</h3>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Email</span>
          <span className="unified-profile-settings-value">{user?.email || 'Not set'}</span>
        </div>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Username</span>
          <span className="unified-profile-settings-value">@{user?.username}</span>
        </div>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Display Name</span>
          <span className="unified-profile-settings-value">{user?.displayName || user?.username}</span>
        </div>
      </div>

      {/* Preferences */}
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Preferences</h3>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Default Travel Mode</span>
          <span className="unified-profile-settings-value">
            {localStorage.getItem('roam_travel_mode') || 'walking'}
          </span>
        </div>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Free Places Only</span>
          <span className="unified-profile-settings-value">
            {localStorage.getItem('roam_free_only') === 'true' ? 'Yes' : 'No'}
          </span>
        </div>
      </div>

      {/* Sign Out */}
      <button className="unified-profile-logout-btn" onClick={onLogout}>
        <LogOutIcon />
        Sign Out
      </button>
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
      className="unified-profile-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="unified-profile-modal"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="unified-profile-modal-header">
          <h3>Followers</h3>
          <button className="unified-profile-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="unified-profile-modal-content">
          {loading && followers.length === 0 ? (
            <div className="unified-profile-modal-loading">Loading...</div>
          ) : followers.length === 0 ? (
            <div className="unified-profile-modal-empty">No followers yet</div>
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
                  className="unified-profile-modal-load-more"
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
      className="unified-profile-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="unified-profile-modal"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="unified-profile-modal-header">
          <h3>Following</h3>
          <button className="unified-profile-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="unified-profile-modal-content">
          {loading && following.length === 0 ? (
            <div className="unified-profile-modal-loading">Loading...</div>
          ) : following.length === 0 ? (
            <div className="unified-profile-modal-empty">Not following anyone yet</div>
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
                  className="unified-profile-modal-load-more"
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
 * Loading Skeleton
 */
function ProfileSkeleton() {
  return (
    <div className="page unified-profile-page">
      <header className="unified-profile-header">
        <div className="unified-profile-back">
          <BackIcon />
        </div>
      </header>

      <div className="unified-profile-card">
        <div className="unified-profile-avatar skeleton" />
        <div className="unified-profile-info">
          <div className="skeleton" style={{ width: '150px', height: '28px', marginBottom: '8px' }} />
          <div className="skeleton" style={{ width: '100px', height: '16px' }} />
        </div>
      </div>

      <div className="unified-profile-stats">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="unified-profile-stat">
            <div className="skeleton" style={{ width: '40px', height: '24px', marginBottom: '4px' }} />
            <div className="skeleton" style={{ width: '60px', height: '14px' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
