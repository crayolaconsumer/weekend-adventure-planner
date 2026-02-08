/**
 * UnifiedProfile Page
 *
 * Merged profile page combining:
 * - Profile.jsx (Your Journey) - gamification, badges, personal stats
 * - UserProfile.jsx - public profile, social features, contributions
 *
 * Tabs: Activity | Journey | Settings (owner only)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { useUserProfile, useFollowers, useFollowing } from '../hooks/useSocial'
import { useUserContributions } from '../hooks/useContributions'
import ActivityItem from '../components/ActivityItem'
import { getVisitedPlaces } from '../utils/statsUtils'
import { useToast } from '../hooks/useToast'
import { useSEO } from '../hooks/useSEO'
import { useUserBadges } from '../hooks/useUserBadges'
import FollowButton from '../components/FollowButton'
import UserCard from '../components/UserCard'
import { ContributionCard } from '../components/ContributionDisplay'
import CategoryChart from '../components/stats/CategoryChart'
import DistanceStats from '../components/stats/DistanceStats'
import MonthlyTrends from '../components/stats/MonthlyTrends'
import VisitedMap from '../components/stats/VisitedMap'
import PrivacySettings from '../components/PrivacySettings'
import UserSearchBar from '../components/UserSearchBar'
import OfflineMapsManager from '../components/OfflineMapsManager'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useDistance } from '../contexts/DistanceContext'
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

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
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
  { id: 'just_go', name: 'Spontaneous', icon: '🎯', description: 'Used Just Go 10 times', requirement: (s) => (s.justGoUses || 0) + (s.boredomBusts || 0) >= 10 },
  { id: 'curator', name: 'Curator', icon: '📚', description: 'Saved 20 places to wishlist', requirement: (s) => s.wishlistCount >= 20 },
  { id: 'planner', name: 'Planner', icon: '📋', description: 'Created 5 adventures', requirement: (s) => s.adventuresCreated >= 5 },
]

// Helper to load stats from localStorage
function loadStatsFromStorage() {
  const savedStats = JSON.parse(localStorage.getItem('roam_stats') || '{}')
  const wishlist = JSON.parse(localStorage.getItem('roam_wishlist') || '[]')
  const adventures = JSON.parse(localStorage.getItem('roam_adventures') || '[]')

  // Use lastStreakDate (not lastActivityDate) - this matches Discover.jsx logic
  const lastStreakDate = savedStats.lastStreakDate
  let currentStreak = savedStats.currentStreak || 0

  if (lastStreakDate) {
    // Check if streak should be reset (more than 1 day since last streak update)
    const lastDate = new Date(lastStreakDate)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    // If lastStreakDate is neither today nor yesterday, streak is broken
    const lastDateStr = lastDate.toDateString()
    const todayStr = today.toDateString()
    const yesterdayStr = yesterday.toDateString()

    if (lastDateStr !== todayStr && lastDateStr !== yesterdayStr) {
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

  // Server-awarded badges (from API)
  const { badges: serverBadges, loading: badgesLoading } = useUserBadges()

  // Tab state
  const [activeTab, setActiveTab] = useState('activity')

  // Dynamic SEO for user profiles
  const displayName = profile?.user?.displayName || profile?.user?.username || username
  useSEO({
    title: isOwnProfile ? 'My Profile' : `${displayName} (@${username})`,
    description: profile?.stats
      ? `${displayName} on ROAM — ${profile.stats.contributions || 0} tips shared, ${profile.stats.followers || 0} followers`
      : `${displayName}'s profile on ROAM`,
    url: `https://go-roam.uk/user/${username}`
  })

  // Modal states
  const [showFollowersModal, setShowFollowersModal] = useState(false)
  const [showFollowingModal, setShowFollowingModal] = useState(false)

  // Toast for badge notifications
  const toast = useToast()
  const badgeCheckDone = useRef(false)

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

  // Check for newly earned badges and show toast notifications
  useEffect(() => {
    if (!isOwnProfile || badgeCheckDone.current) return

    // Get previously stored earned badge IDs
    const storedBadgeIds = JSON.parse(localStorage.getItem('roam_earned_badges') || '[]')
    const currentBadgeIds = earnedBadges.map(b => b.id)

    // Find new badges (in current but not in stored)
    const newBadges = earnedBadges.filter(b => !storedBadgeIds.includes(b.id))

    // Show toast for each new badge
    if (newBadges.length > 0) {
      // Small delay to ensure toast is visible after page loads
      setTimeout(() => {
        newBadges.forEach((badge, index) => {
          // Stagger toasts so they don't overlap
          setTimeout(() => {
            toast.success(`${badge.icon} Badge Unlocked: ${badge.name}!`)
          }, index * 1000)
        })
      }, 500)

      // Save current badges to localStorage
      localStorage.setItem('roam_earned_badges', JSON.stringify(currentBadgeIds))
    } else if (currentBadgeIds.length !== storedBadgeIds.length) {
      // Sync if mismatch (e.g., badge list changed)
      localStorage.setItem('roam_earned_badges', JSON.stringify(currentBadgeIds))
    }

    badgeCheckDone.current = true
  }, [isOwnProfile, earnedBadges, toast])

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

  const {
    user,
    stats,
    contributions,
    isFollowing,
    followStatus,
    isPrivateAccount,
    canSeeFullProfile,
    hideFollowersList,
    hideFollowingList
  } = profile
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
        {/* Settings moved to tab bar - removed duplicate header button */}
        <div className="unified-profile-header-spacer" />
      </header>

      {/* User Search - only on own profile */}
      {isOwnProfile && (
        <div className="unified-profile-search-section">
          <UserSearchBar
            placeholder="Find people to follow..."
            onResultClick={(clickedUser) => navigate(`/user/${clickedUser.username}`)}
          />
        </div>
      )}

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
            <span className="unified-profile-header-level">
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
              initialFollowStatus={followStatus}
              isPrivateAccount={isPrivateAccount}
              onFollowChange={handleFollowChange}
              size="large"
            />
          </div>
        )}

        {/* Private account indicator */}
        {isPrivateAccount && !isOwnProfile && !canSeeFullProfile && (
          <div className="unified-profile-private-notice">
            <LockIcon />
            <span>This account is private. Follow to see their activity.</span>
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
        {hideFollowersList && !isOwnProfile ? (
          <div className="unified-profile-stat hidden">
            <span className="unified-profile-stat-value">-</span>
            <span className="unified-profile-stat-label">Followers</span>
          </div>
        ) : (
          <button
            className="unified-profile-stat"
            onClick={() => setShowFollowersModal(true)}
          >
            <span className="unified-profile-stat-value">{stats.followers}</span>
            <span className="unified-profile-stat-label">Followers</span>
          </button>
        )}

        {hideFollowingList && !isOwnProfile ? (
          <div className="unified-profile-stat hidden">
            <span className="unified-profile-stat-value">-</span>
            <span className="unified-profile-stat-label">Following</span>
          </div>
        ) : (
          <button
            className="unified-profile-stat"
            onClick={() => setShowFollowingModal(true)}
          >
            <span className="unified-profile-stat-value">{stats.following}</span>
            <span className="unified-profile-stat-label">Following</span>
          </button>
        )}

        <div className="unified-profile-stat">
          <span className="unified-profile-stat-value">{stats.placesVisited || stats.contributions || 0}</span>
          <span className="unified-profile-stat-label">Visited</span>
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
              activities={profile.activities}
              loading={isOwnProfile ? contribLoading : false}
              user={user}
              isOwnProfile={isOwnProfile}
              isPrivateAccount={isPrivateAccount}
              canSeeFullProfile={canSeeFullProfile}
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
              serverBadges={serverBadges}
              badgesLoading={badgesLoading}
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
 * Activity Tab - Unified Activity (Visits, Tips, Photos)
 */
function ActivityTab({ contributions, activities, loading, user, isOwnProfile, isPrivateAccount, canSeeFullProfile }) {
  // Use activities if available, fallback to contributions
  const activityList = activities && activities.length > 0 ? activities : contributions

  // Show private account message if user can't see full profile
  if (!isOwnProfile && isPrivateAccount && !canSeeFullProfile) {
    return (
      <div className="unified-profile-private">
        <span className="unified-profile-private-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </span>
        <h3>This account is private</h3>
        <p>Follow this account to see their tips and activity.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="unified-profile-loading">
        <div className="unified-profile-spinner" />
        <span>Loading activity...</span>
      </div>
    )
  }

  if (!activityList || activityList.length === 0) {
    return (
      <div className="unified-profile-empty">
        <span className="unified-profile-empty-icon">💭</span>
        <p>{isOwnProfile ? "You haven't shared any activity yet" : "No activity yet"}</p>
        {isOwnProfile && (
          <p className="unified-profile-empty-hint">
            Visit a place and share what made it special!
          </p>
        )}
      </div>
    )
  }

  // Check if we have the new activity format (with activityType) or old format
  const hasNewFormat = activityList.some(a => a.activityType)

  return (
    <div className="unified-profile-activities">
      {hasNewFormat ? (
        // New format: use ActivityItem for richer display
        activityList.map((activity, index) => (
          <ActivityItem
            key={activity.id}
            activity={{
              id: activity.id,
              type: activity.activityType,
              createdAt: activity.createdAt,
              content: activity.content,
              rating: activity.rating,
              upvotes: activity.upvotes,
              downvotes: activity.downvotes,
              score: activity.score,
              metadata: activity.metadata,
              place: activity.place || {
                id: activity.placeId,
                name: activity.placeName,
                category: activity.placeCategory
              },
              user: {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl
              }
            }}
            index={index}
          />
        ))
      ) : (
        // Legacy format: use ContributionCard
        activityList.map(contribution => (
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
  )
}

// Server badge display config (maps badge_id to icon/name)
const SERVER_BADGE_CONFIG = {
  first_contribution: { icon: '✍️', name: 'First Steps', description: 'Made your first contribution' },
  contributor_10: { icon: '📝', name: 'Local Expert', description: 'Made 10 contributions' },
  contributor_50: { icon: '🏆', name: 'Community Pillar', description: 'Made 50 contributions' },
  first_visit: { icon: '🧭', name: 'Explorer', description: 'Visited your first place' },
  visits_10: { icon: '🗺️', name: 'Adventurer', description: 'Visited 10 places' },
  visits_50: { icon: '🌍', name: 'Seasoned Traveler', description: 'Visited 50 places' },
  visits_100: { icon: '🌟', name: 'World Wanderer', description: 'Visited 100 places' },
  followers_10: { icon: '⭐', name: 'Rising Star', description: 'Gained 10 followers' },
  followers_100: { icon: '👑', name: 'Influencer', description: 'Gained 100 followers' },
}

/**
 * Journey Tab - Gamification, Badges, Stats
 */
function JourneyTab({ stats, level, levelProgress, nextLevelRequirement, totalActivity, earnedBadges, lockedBadges, serverBadges, badgesLoading, visitedPlaces, isOwnProfile }) {
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

        {/* Server-awarded badges (contributions, visits, followers) */}
        {serverBadges && serverBadges.length > 0 && (
          <>
            <h4 className="unified-profile-subsection-title">Achievements</h4>
            <div className="unified-profile-badges earned server-badges">
              {serverBadges.map((badge, index) => {
                const config = SERVER_BADGE_CONFIG[badge.badgeId] || {
                  icon: '🏅',
                  name: badge.badgeId.replace(/_/g, ' '),
                  description: 'Achievement unlocked'
                }
                return (
                  <motion.div
                    key={badge.badgeId}
                    className="unified-profile-badge server"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    title={`Earned ${new Date(badge.earnedAt).toLocaleDateString()}`}
                  >
                    <span className="unified-profile-badge-icon">{config.icon}</span>
                    <span className="unified-profile-badge-name">{config.name}</span>
                    <span className="unified-profile-badge-desc">{config.description}</span>
                  </motion.div>
                )
              })}
            </div>
          </>
        )}

        {/* Client-side activity badges */}
        {earnedBadges.length > 0 && (
          <>
            <h4 className="unified-profile-subsection-title">Activity</h4>
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
          </>
        )}

        {/* Loading state for server badges */}
        {badgesLoading && (
          <div className="unified-profile-badges-loading">
            <span className="unified-profile-spinner-small" />
            Loading badges...
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
 * Settings Tab - Account Management (Fully Editable)
 */
function SettingsTab({ user, onLogout }) {
  const { updateProfile } = useAuth()
  const { isPremium, manageSubscription, loading: subLoading, error: subError, expiresAt, isCancelled } = useSubscription()
  const { distanceUnit, setDistanceUnit } = useDistance()

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Form state for account info
  const [displayName, setDisplayName] = useState(user?.displayName || '')

  // Preferences state (localStorage-backed)
  const [travelMode, setTravelMode] = useState(() =>
    localStorage.getItem('roam_travel_mode') || 'walking'
  )
  const [freeOnly, setFreeOnly] = useState(() =>
    localStorage.getItem('roam_free_only') === 'true'
  )
  const [accessibilityMode, setAccessibilityMode] = useState(() =>
    localStorage.getItem('roam_accessibility') === 'true'
  )
  const [openOnly, setOpenOnly] = useState(() =>
    localStorage.getItem('roam_open_only') === 'true'
  )

  // Travel mode options
  const travelModes = {
    walking: { label: 'Walking', icon: '🚶', desc: 'Up to 5km' },
    driving: { label: 'Driving', icon: '🚗', desc: 'Up to 30km' },
    transit: { label: 'Transit', icon: '🚌', desc: 'Up to 15km' }
  }

  // Reset form when user changes
  useEffect(() => {
    setDisplayName(user?.displayName || '')
  }, [user?.displayName])

  // Track if there are unsaved changes
  const hasUnsavedChanges = isEditing && (
    displayName !== (user?.displayName || '') ||
    travelMode !== (localStorage.getItem('roam_travel_mode') || 'walking') ||
    freeOnly !== (localStorage.getItem('roam_free_only') === 'true') ||
    accessibilityMode !== (localStorage.getItem('roam_accessibility') === 'true') ||
    openOnly !== (localStorage.getItem('roam_open_only') === 'true')
  )

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
        return e.returnValue
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Save preferences to localStorage
  const savePreferences = useCallback(() => {
    localStorage.setItem('roam_travel_mode', travelMode)
    localStorage.setItem('roam_free_only', freeOnly.toString())
    localStorage.setItem('roam_accessibility', accessibilityMode.toString())
    localStorage.setItem('roam_open_only', openOnly.toString())
  }, [travelMode, freeOnly, accessibilityMode, openOnly])

  // Handle save
  const handleSave = async () => {
    setSaveError('')
    setSaveSuccess(false)
    setIsSaving(true)

    try {
      // Save account info to backend if changed
      if (displayName !== (user?.displayName || '')) {
        const result = await updateProfile({ displayName: displayName || null })
        if (!result.success) {
          throw new Error(result.error)
        }
      }

      // Save preferences to localStorage
      savePreferences()

      setSaveSuccess(true)
      setIsEditing(false)

      // Clear success message after 3s
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(err.message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle cancel
  const handleCancel = () => {
    // Reset form to current values
    setDisplayName(user?.displayName || '')
    setTravelMode(localStorage.getItem('roam_travel_mode') || 'walking')
    setFreeOnly(localStorage.getItem('roam_free_only') === 'true')
    setAccessibilityMode(localStorage.getItem('roam_accessibility') === 'true')
    setOpenOnly(localStorage.getItem('roam_open_only') === 'true')
    setSaveError('')
    setIsEditing(false)
  }

  return (
    <div className="unified-profile-settings">
      {/* Premium Section */}
      {!isPremium ? (
        <div className="unified-profile-settings-section premium-upgrade-section">
          <Link to="/pricing" className="profile-upgrade-btn">
            <span className="upgrade-text">Upgrade to ROAM+</span>
            <span className="upgrade-badge">7 days free</span>
          </Link>
        </div>
      ) : (
        <div className="unified-profile-settings-section premium-active-section">
          <div className="premium-status-card">
            <div className="premium-status-header">
              <span className="premium-status-badge">
                <span className="premium-crown">👑</span>
                ROAM+ Member
              </span>
            </div>
            <p className="premium-status-perks">Unlimited swipes, hidden gems, and more</p>
            {expiresAt && (
              <p className="premium-status-expiry">
                {isCancelled
                  ? `Access until ${new Date(expiresAt).toLocaleDateString()}`
                  : `Renews ${new Date(expiresAt).toLocaleDateString()}`
                }
              </p>
            )}
            {isCancelled && (
              <p className="premium-status-cancelled">Your subscription won't renew</p>
            )}
            <button
              className="premium-manage-btn"
              onClick={manageSubscription}
              disabled={subLoading}
            >
              {subLoading ? 'Loading...' : 'Manage Subscription'}
            </button>
            {subError && (
              <div className="premium-manage-error-container">
                <p className="premium-manage-error">{subError}</p>
                {subError.includes('Subscribe') && (
                  <Link to="/pricing" className="premium-manage-subscribe-link">
                    Subscribe to ROAM+
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Message */}
      {saveSuccess && (
        <div className="unified-profile-settings-success" role="status">
          Settings saved successfully
        </div>
      )}

      {/* Error Message */}
      {saveError && (
        <div className="unified-profile-settings-error" role="alert">
          {saveError}
        </div>
      )}

      {/* Account Info */}
      <div className="unified-profile-settings-section">
        <div className="unified-profile-settings-header">
          <h3 className="unified-profile-settings-title">Account</h3>
          {!isEditing && (
            <button
              className="unified-profile-settings-edit-btn"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          )}
        </div>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Email</span>
          <span className="unified-profile-settings-value">{user?.email || 'Not set'}</span>
        </div>

        <div className="unified-profile-settings-item">
          <span className="unified-profile-settings-label">Username</span>
          <span className="unified-profile-settings-value">@{user?.username}</span>
        </div>

        {isEditing ? (
          <div className="unified-profile-settings-field">
            <label htmlFor="displayName" className="unified-profile-settings-label">
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              className="unified-profile-settings-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter display name"
              maxLength={50}
              disabled={isSaving}
            />
          </div>
        ) : (
          <div className="unified-profile-settings-item">
            <span className="unified-profile-settings-label">Display Name</span>
            <span className="unified-profile-settings-value">
              {user?.displayName || user?.username || 'Not set'}
            </span>
          </div>
        )}
      </div>

      {/* Preferences */}
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Preferences</h3>

        {/* Travel Mode */}
        <div className="unified-profile-settings-field">
          <span className="unified-profile-settings-label">Default Travel Mode</span>
          <div className="unified-profile-settings-mode-grid">
            {Object.entries(travelModes).map(([key, mode]) => (
              <button
                key={key}
                className={`unified-profile-settings-mode-btn ${travelMode === key ? 'active' : ''}`}
                onClick={() => {
                  setTravelMode(key)
                  if (!isEditing) {
                    localStorage.setItem('roam_travel_mode', key)
                  }
                }}
                disabled={isSaving}
              >
                <span className="mode-icon">{mode.icon}</span>
                <span className="mode-label">{mode.label}</span>
                <span className="mode-desc">{mode.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Distance Units */}
        <div className="unified-profile-settings-field">
          <span className="unified-profile-settings-label">Distance Units</span>
          <div className="unified-profile-settings-segment">
            <button
              className={`unified-profile-settings-segment-btn ${distanceUnit === 'km' ? 'active' : ''}`}
              onClick={() => setDistanceUnit('km')}
              disabled={isSaving}
            >
              Kilometers
            </button>
            <button
              className={`unified-profile-settings-segment-btn ${distanceUnit === 'mi' ? 'active' : ''}`}
              onClick={() => setDistanceUnit('mi')}
              disabled={isSaving}
            >
              Miles
            </button>
          </div>
        </div>

        {/* Toggle Preferences */}
        <div className="unified-profile-settings-toggles">
          <button
            className={`unified-profile-settings-toggle ${freeOnly ? 'active' : ''}`}
            onClick={() => {
              const newValue = !freeOnly
              setFreeOnly(newValue)
              if (!isEditing) {
                localStorage.setItem('roam_free_only', newValue.toString())
              }
            }}
            disabled={isSaving}
            aria-pressed={freeOnly}
          >
            <span className="toggle-icon">💸</span>
            <span className="toggle-text">
              <span className="toggle-label">Free Places Only</span>
              <span className="toggle-desc">Show only free attractions</span>
            </span>
            <span className={`toggle-switch ${freeOnly ? 'on' : ''}`}>
              <span className="toggle-knob" />
            </span>
          </button>

          <button
            className={`unified-profile-settings-toggle ${accessibilityMode ? 'active' : ''}`}
            onClick={() => {
              const newValue = !accessibilityMode
              setAccessibilityMode(newValue)
              if (!isEditing) {
                localStorage.setItem('roam_accessibility', newValue.toString())
              }
            }}
            disabled={isSaving}
            aria-pressed={accessibilityMode}
          >
            <span className="toggle-icon">♿</span>
            <span className="toggle-text">
              <span className="toggle-label">Accessibility Mode</span>
              <span className="toggle-desc">Prioritize accessible places</span>
            </span>
            <span className={`toggle-switch ${accessibilityMode ? 'on' : ''}`}>
              <span className="toggle-knob" />
            </span>
          </button>

          <button
            className={`unified-profile-settings-toggle ${openOnly ? 'active' : ''}`}
            onClick={() => {
              const newValue = !openOnly
              setOpenOnly(newValue)
              if (!isEditing) {
                localStorage.setItem('roam_open_only', newValue.toString())
              }
            }}
            disabled={isSaving}
            aria-pressed={openOnly}
          >
            <span className="toggle-icon">🕐</span>
            <span className="toggle-text">
              <span className="toggle-label">Open Now Only</span>
              <span className="toggle-desc">Hide places that are closed</span>
            </span>
            <span className={`toggle-switch ${openOnly ? 'on' : ''}`}>
              <span className="toggle-knob" />
            </span>
          </button>
        </div>
      </div>

      {/* Save/Cancel Buttons (when editing account info) */}
      {isEditing && (
        <div className="unified-profile-settings-actions">
          <button
            className="unified-profile-settings-cancel-btn"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className="unified-profile-settings-save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Notifications Section */}
      <NotificationsSection />

      {/* Offline Maps Section */}
      <div className="unified-profile-settings-section">
        <OfflineMapsManager userLocation={null} />
      </div>

      {/* Privacy Settings */}
      <div className="unified-profile-settings-section">
        <PrivacySettings />
      </div>

      {/* Sign Out */}
      <button className="unified-profile-logout-btn" onClick={onLogout}>
        <LogOutIcon />
        Sign Out
      </button>
    </div>
  )
}

// Helper to get auth token
function getAuthToken() {
  return localStorage.getItem('roam_auth_token') || sessionStorage.getItem('roam_auth_token_session')
}

/**
 * Notifications Section - Push notification settings with granular preferences
 */
function NotificationsSection() {
  const {
    supported,
    permission,
    isSubscribed,
    loading,
    error,
    subscribe,
    unsubscribe
  } = usePushNotifications()

  // Notification preferences state
  const [prefs, setPrefs] = useState({
    newFollower: true,
    newContribution: true,
    planShared: true,
    weeklyDigest: true,
    visitReminder: true
  })
  const [prefsLoading, setPrefsLoading] = useState(true)

  // Load notification preferences
  useEffect(() => {
    const loadPrefs = async () => {
      const token = getAuthToken()
      if (!token) {
        setPrefsLoading(false)
        return
      }

      try {
        const response = await fetch('/api/users/notification-preferences', {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include'
        })
        if (response.ok) {
          const data = await response.json()
          setPrefs(data.preferences)
        }
      } catch (err) {
        console.error('Failed to load notification preferences:', err)
      } finally {
        setPrefsLoading(false)
      }
    }

    loadPrefs()
  }, [])

  // Update a specific preference
  const updatePref = async (key, value) => {
    // Optimistic update
    setPrefs(prev => ({ ...prev, [key]: value }))

    const token = getAuthToken()
    if (!token) return

    try {
      await fetch('/api/users/notification-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({ [key]: value })
      })
    } catch (err) {
      // Revert on error
      setPrefs(prev => ({ ...prev, [key]: !value }))
      console.error('Failed to update notification preference:', err)
    }
  }

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe()
    } else {
      await subscribe()
    }
  }

  // Not supported in this browser
  if (!supported) {
    return (
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Notifications</h3>
        <p className="unified-profile-settings-unsupported">
          Push notifications are not supported in this browser.
        </p>
      </div>
    )
  }

  // Permission denied
  if (permission === 'denied') {
    return (
      <div className="unified-profile-settings-section">
        <h3 className="unified-profile-settings-title">Notifications</h3>
        <p className="unified-profile-settings-blocked">
          Notifications are blocked. Enable them in your browser settings to receive updates.
        </p>
      </div>
    )
  }

  return (
    <div className="unified-profile-settings-section">
      <h3 className="unified-profile-settings-title">Notifications</h3>

      <div className="unified-profile-settings-toggles">
        {/* Master push toggle */}
        <button
          className={`unified-profile-settings-toggle ${isSubscribed ? 'active' : ''}`}
          onClick={handleToggle}
          disabled={loading}
          aria-pressed={isSubscribed}
        >
          <span className="toggle-icon">🔔</span>
          <span className="toggle-text">
            <span className="toggle-label">Push Notifications</span>
            <span className="toggle-desc">
              {isSubscribed
                ? 'Receiving notifications'
                : 'Enable to receive updates'}
            </span>
          </span>
          <span className={`toggle-switch ${isSubscribed ? 'on' : ''}`}>
            <span className="toggle-knob" />
          </span>
        </button>

        {/* Granular preferences - only show when subscribed */}
        {isSubscribed && prefsLoading && (
          <div className="unified-profile-settings-prefs-loading">
            <span className="unified-profile-spinner-small" />
            <span>Loading notification preferences...</span>
          </div>
        )}
        {isSubscribed && !prefsLoading && (
          <>
            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.newFollower ? 'active' : ''}`}
              onClick={() => updatePref('newFollower', !prefs.newFollower)}
              aria-pressed={prefs.newFollower}
            >
              <span className="toggle-text">
                <span className="toggle-label">New Followers</span>
                <span className="toggle-desc">When someone follows you</span>
              </span>
              <span className={`toggle-switch ${prefs.newFollower ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.newContribution ? 'active' : ''}`}
              onClick={() => updatePref('newContribution', !prefs.newContribution)}
              aria-pressed={prefs.newContribution}
            >
              <span className="toggle-icon">⬆️</span>
              <span className="toggle-text">
                <span className="toggle-label">Tip Upvotes</span>
                <span className="toggle-desc">When your tips get upvoted</span>
              </span>
              <span className={`toggle-switch ${prefs.newContribution ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.planShared ? 'active' : ''}`}
              onClick={() => updatePref('planShared', !prefs.planShared)}
              aria-pressed={prefs.planShared}
            >
              <span className="toggle-icon">🗺️</span>
              <span className="toggle-text">
                <span className="toggle-label">Shared Plans</span>
                <span className="toggle-desc">When someone shares a plan with you</span>
              </span>
              <span className={`toggle-switch ${prefs.planShared ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.weeklyDigest ? 'active' : ''}`}
              onClick={() => updatePref('weeklyDigest', !prefs.weeklyDigest)}
              aria-pressed={prefs.weeklyDigest}
            >
              <span className="toggle-icon">📬</span>
              <span className="toggle-text">
                <span className="toggle-label">Weekly Digest</span>
                <span className="toggle-desc">Weekly summary of activity</span>
              </span>
              <span className={`toggle-switch ${prefs.weeklyDigest ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              className={`unified-profile-settings-toggle sub-toggle ${prefs.visitReminder ? 'active' : ''}`}
              onClick={() => updatePref('visitReminder', !prefs.visitReminder)}
              aria-pressed={prefs.visitReminder}
            >
              <span className="toggle-icon">📅</span>
              <span className="toggle-text">
                <span className="toggle-label">Visit Reminders</span>
                <span className="toggle-desc">Reminder on your planned visit day</span>
              </span>
              <span className={`toggle-switch ${prefs.visitReminder ? 'on' : ''}`}>
                <span className="toggle-knob" />
              </span>
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="unified-profile-settings-error-inline">{error}</p>
      )}
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
