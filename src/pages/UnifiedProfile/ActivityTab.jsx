import ActivityItem, { ActivityItemSkeleton } from '../../components/ActivityItem'
import { ContributionCard } from '../../components/ContributionDisplay'
import EmptyStateIllustration from '../../components/icons/EmptyStateIllustration'

/**
 * Activity feed for a user's profile.
 *
 * Handles three states:
 *   - Private account that the viewer can't see (lock screen).
 *   - Loading (skeletons).
 *   - Loaded with empty / populated activity.
 *
 * Supports both the new ActivityItem-style records (with `activityType`)
 * and legacy ContributionCard records, picking the renderer based on
 * whether any record has the new shape.
 */
export default function ActivityTab({
  contributions,
  activities,
  loading,
  user,
  isOwnProfile,
  isPrivateAccount,
  canSeeFullProfile,
}) {
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
      <div className="unified-profile-activity-loading" role="status" aria-live="polite">
        {[0, 1, 2, 3].map(i => (
          <ActivityItemSkeleton key={i} />
        ))}
        <span className="visually-hidden">Loading activity</span>
      </div>
    )
  }

  if (!activityList || activityList.length === 0) {
    return (
      <div className="unified-profile-empty">
        <span className="unified-profile-empty-icon">
          <EmptyStateIllustration variant="thoughts" size="sm" />
        </span>
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
                category: activity.placeCategory,
              },
              user: {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
              },
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
                avatarUrl: user.avatarUrl,
              },
            }}
            showUser={false}
          />
        ))
      )}
    </div>
  )
}
