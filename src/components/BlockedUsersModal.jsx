/**
 * BlockedUsersModal Component
 *
 * Modal to view and manage blocked users
 */

import { motion } from 'framer-motion'
import { useBlockedUsers } from '../hooks/useBlockedUsers'
import { formatDate } from '../utils/dateUtils'
import './BlockedUsersModal.css'

export default function BlockedUsersModal({ onClose }) {
  const {
    blockedUsers,
    loading,
    error,
    total,
    hasMore,
    processing,
    unblockUser,
    loadMore
  } = useBlockedUsers()

  const handleUnblock = async (userId) => {
    await unblockUser(userId)
  }

  return (
    <motion.div
      className="blocked-users-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="blocked-users-modal"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="blocked-users-modal-header">
          <h3>Blocked Users</h3>
          {total > 0 && <span className="blocked-count">{total} blocked</span>}
          <button className="blocked-users-modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="blocked-users-modal-content">
          {loading && blockedUsers.length === 0 ? (
            <div className="blocked-users-loading">
              <div className="blocked-users-spinner" />
              <span>Loading blocked users...</span>
            </div>
          ) : error ? (
            <div className="blocked-users-error">
              <span className="error-icon">!</span>
              <p>{error}</p>
            </div>
          ) : blockedUsers.length === 0 ? (
            <div className="blocked-users-empty">
              <span className="empty-icon">
                <BlockIcon />
              </span>
              <p>No blocked users</p>
              <span className="empty-desc">
                Blocked users can't see your profile or find you in search
              </span>
            </div>
          ) : (
            <>
              <div className="blocked-users-list">
                {blockedUsers.map(item => (
                  <div key={item.blockId} className="blocked-user-item">
                    <div className="blocked-user-info">
                      <img
                        src={item.user.avatarUrl ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(item.user.displayName || item.user.username)}&background=E07A5F&color=fff&size=80`}
                        alt={item.user.displayName || item.user.username}
                        className="blocked-user-avatar"
                      />
                      <div className="blocked-user-details">
                        <span className="blocked-user-name">
                          {item.user.displayName || item.user.username}
                        </span>
                        <span className="blocked-user-username">
                          @{item.user.username}
                        </span>
                        <span className="blocked-user-time">
                          Blocked {formatDate(new Date(item.blockedAt))}
                        </span>
                      </div>
                    </div>

                    <button
                      className="blocked-user-unblock"
                      onClick={() => handleUnblock(item.user.id)}
                      disabled={processing === item.user.id}
                    >
                      {processing === item.user.id ? 'Unblocking...' : 'Unblock'}
                    </button>
                  </div>
                ))}
              </div>

              {hasMore && (
                <button
                  className="blocked-users-load-more"
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

// Icons
function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function BlockIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
  )
}
