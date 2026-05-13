import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import AchievementBadge from '../../components/icons/AchievementBadge'
import CategoryChart from '../../components/stats/CategoryChart'
import MonthlyTrends from '../../components/stats/MonthlyTrends'
import MapPreviewBand from '../../components/profile/MapPreviewBand'
import { SERVER_BADGE_CONFIG } from './badges'

/**
 * Journey tab — gamification, badges, stats, map preview.
 *
 * Pure presentational: takes computed stats / earned + locked badges /
 * server-awarded badges as props. The owning page is responsible for
 * loading data and recomputing level/progress.
 */
export default function JourneyTab({
  username,
  stats,
  level,
  levelProgress,
  nextLevelRequirement,
  totalActivity,
  earnedBadges,
  lockedBadges,
  serverBadges,
  badgesLoading,
  visitedPlaces,
  isOwnProfile,
}) {
  const navigate = useNavigate()
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
          {/* Use the same source as the header "Visited" counter
              (server stats + localStorage fallback). Previously this
              card showed stats.timesWentOut — a separate counter that
              only ticks when the user taps "Let's Go" on Discover —
              while the header showed actual visited count, so the two
              numbers contradicted each other on the same screen. */}
          <span className="unified-profile-stat-card-value">{stats.placesVisited || visitedPlaces.length || 0}</span>
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
                  description: 'Achievement unlocked',
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
                    <span className="unified-profile-badge-icon">
                      <AchievementBadge id={badge.badgeId} size="lg" />
                    </span>
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
                  <span className="unified-profile-badge-icon">
                    <AchievementBadge id={badge.id} size="lg" />
                  </span>
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
                  <span className="unified-profile-badge-icon">
                    <AchievementBadge id={badge.id} size="lg" locked />
                  </span>
                  <span className="unified-profile-badge-name">{badge.name}</span>
                  <span className="unified-profile-badge-desc">{badge.description}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Map Preview — first thing in the Journey tab. Tap → opens the
          full /user/:username/map page (Leaflet map + list + edit reviews). */}
      <div className="unified-profile-journey-map">
        <h3 className="unified-profile-section-title">Your Map</h3>
        <MapPreviewBand
          places={visitedPlaces}
          onClick={() => username && navigate(`/user/${username}/map`)}
          label="View your visited places map"
        />
      </div>

      {/* Visual Stats - Owner Only */}
      {isOwnProfile && visitedPlaces.length > 0 && (
        <div className="unified-profile-viz-section">
          <div className="unified-profile-viz-grid">
            <CategoryChart places={visitedPlaces} />
          </div>
          <div className="unified-profile-viz-grid">
            <MonthlyTrends places={visitedPlaces} />
          </div>
        </div>
      )}

      {/* Best Streak */}
      {stats.bestStreak > 0 && (
        <div className="unified-profile-highlight">
          <span className="unified-profile-highlight-icon">
            <AchievementBadge id="streak_30" size="md" />
          </span>
          <div className="unified-profile-highlight-content">
            <span className="unified-profile-highlight-value">{stats.bestStreak} days</span>
            <span className="unified-profile-highlight-label">Best Streak</span>
          </div>
        </div>
      )}
    </div>
  )
}
