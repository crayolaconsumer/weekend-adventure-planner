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
import EmptyStateIllustration from '../components/icons/EmptyStateIllustration'
import { useUserProfile } from '../hooks/useSocial'
import { useUserContributions } from '../hooks/useContributions'
import Avatar from '../components/Avatar'
import { getVisitedPlaces } from '../utils/statsUtils'
import { useToast } from '../hooks/useToast'
import { useSEO } from '../hooks/useSEO'
import { useUserBadges } from '../hooks/useUserBadges'
import FollowButton from '../components/FollowButton'
import ModerationMenu from '../components/ModerationMenu'
import PremiumBadge from '../components/PremiumBadge'
import { formatDate } from '../utils/dateUtils'
import { formatDisplayName } from '../utils/displayName'
import { BackIcon, CalendarIcon, LockIcon } from './UnifiedProfile/icons'
import { BADGES } from './UnifiedProfile/badges'
import { loadStatsFromStorage, computeLevel } from './UnifiedProfile/utils'
import ProfileSkeleton from './UnifiedProfile/ProfileSkeleton'
import { FollowersModal, FollowingModal } from './UnifiedProfile/modals'
import ActivityTab from './UnifiedProfile/ActivityTab'
import JourneyTab from './UnifiedProfile/JourneyTab'
import SettingsTab from './UnifiedProfile/SettingsTab'
import './UnifiedProfile.css'

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
  const displayName = formatDisplayName(profile?.user) || username
  useSEO({
    title: isOwnProfile ? 'My Profile' : `${displayName} (@${username})`,
    description: profile?.stats
      ? `${displayName} on ROAM — ${profile.stats.contributions || 0} tips shared, ${profile.stats.followers || 0} followers`
      : `${displayName}'s profile on ROAM`,
    url: `https://www.go-roam.uk/user/${username}`
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

  // Level rank — now derived from SERVER stats (computeLevel reads
  // profile.stats which is per-user from /api/users/[username]). This
  // means viewing dad's profile shows dad's level on every device,
  // not "whichever device's localStorage answered first". Curve is
  // unchanged so existing badges still align with their level
  // thresholds. See computeLevel() in UnifiedProfile/utils.ts.
  const { level, levelProgress, nextLevelRequirement, totalActivity } = computeLevel(profile?.stats)

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
            toast.success(`Badge Unlocked: ${badge.name}!`)
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
          <div className="unified-profile-error-icon">
            <EmptyStateIllustration variant="error" size="md" />
          </div>
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

      {/* User Search removed — Social tab already has a polished
          UserSearchBar; duplicating it on the Profile header added
          noise to a page that should be about the current user's own
          stats and settings. */}

      {/* Profile Card */}
      <motion.section
        className="unified-profile-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="avatar-with-premium unified-profile-avatar-wrap">
          {/* Uses the shared Avatar component so the no-photo fallback
              renders identical hue-rotated initials as the Social tab's
              "My Profile" link — previously the profile used a separate
              ui-avatars.com URL (terracotta + white) which made the same
              user look different on each screen. */}
          <Avatar
            user={user}
            size={100}
            className="unified-profile-avatar"
            alt={formatDisplayName(user)}
          />
          {user.isPremium && <PremiumBadge size={32} />}
        </span>

        <div className="unified-profile-info">
          <h2 className="unified-profile-name">
            {formatDisplayName(user)}
          </h2>
          <p className="unified-profile-username">@{user.username}</p>

          {/* Level badge (public). Show on own profile from Level 1
              onwards so new users immediately see their starting rank,
              and on others' profiles too — a user's level is public
              information, no reason to hide it. */}
          {level >= 1 && (
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
            <ModerationMenu
              entityType="user"
              entityId={user.id}
              entityLabel={`@${user.username}`}
              authorId={user.id}
              authorUsername={user.username}
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

      {/* Stats Bar — four columns: Followers / Following / Visited / Helpful.
          The Visited tile is tappable on every profile and navigates to the
          full /user/:username/map page (real map + expandable list + edit
          reviews for the owner). The map preview itself lives in the Journey
          tab now — first-class but not in the header where it competed with
          the avatar, name, and follow button. */}
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

        <button
          className="unified-profile-stat"
          onClick={() => navigate(`/user/${user.username}/map`)}
          aria-label="View visited places map and list"
        >
          <span className="unified-profile-stat-value">
            {/* Server is source of truth. Previously OR-fell through to
                localStorage count when the server returned a legitimate
                0, which leaked the previous user's count on shared
                devices and confused users who genuinely had 0 visits. */}
            {stats.placesVisited ?? 0}
          </span>
          <span className="unified-profile-stat-label">Visited</span>
        </button>

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
              username={user.username}
              stats={localStats}
              serverStats={stats}
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
              onLogout={async () => {
                // Navigate FIRST then logout — if we logout first, the
                // profile page re-renders with user=null, which used to
                // leave the user stranded on their own URL with nothing
                // useful to see. Replace history entry so back button
                // doesn't bring them back to the now-empty profile.
                navigate('/', { replace: true })
                await logout()
              }}
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

