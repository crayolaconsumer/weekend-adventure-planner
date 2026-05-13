import { motion } from 'framer-motion'
import UserCard from '../../components/UserCard'
import { useFollowers, useFollowing } from '../../hooks/useSocial'

/**
 * Modal that lists the users following the given userId.
 */
export function FollowersModal({ userId, onClose }) {
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
 * Modal that lists who this user is following.
 */
export function FollowingModal({ userId, onClose }) {
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
