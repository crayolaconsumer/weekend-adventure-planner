/**
 * FollowRequestsModal Component
 *
 * Modal to view and manage pending follow requests
 */

import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useFollowRequests } from '../hooks/useFollowRequests'
import { formatDate } from '../utils/dateUtils'
import './FollowRequestsModal.css'

export default function FollowRequestsModal({ onClose }) {
  const {
    requests,
    loading,
    error,
    total,
    hasMore,
    processing,
    approveRequest,
    rejectRequest,
    loadMore
  } = useFollowRequests()

  const handleApprove = async (requestId) => {
    await approveRequest(requestId)
  }

  const handleReject = async (requestId) => {
    await rejectRequest(requestId)
  }

  return (
    <motion.div
      className="follow-requests-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="follow-requests-modal"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="follow-requests-modal-header">
          <h3>Follow Requests</h3>
          {total > 0 && <span className="request-count">{total} pending</span>}
          <button className="follow-requests-modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="follow-requests-modal-content">
          {loading && requests.length === 0 ? (
            <div className="follow-requests-loading">
              <div className="follow-requests-spinner" />
              <span>Loading requests...</span>
            </div>
          ) : error ? (
            <div className="follow-requests-error">
              <span className="error-icon">!</span>
              <p>{error}</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="follow-requests-empty">
              <span className="empty-icon">
                <UsersIcon />
              </span>
              <p>No pending follow requests</p>
            </div>
          ) : (
            <>
              <div className="follow-requests-list">
                {requests.map(request => (
                  <div key={request.id} className="follow-request-item">
                    <Link
                      to={`/user/${request.user.username}`}
                      className="follow-request-user"
                      onClick={onClose}
                    >
                      <img
                        src={request.user.avatarUrl ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(request.user.displayName || request.user.username)}&background=E07A5F&color=fff&size=80`}
                        alt={request.user.displayName || request.user.username}
                        className="follow-request-avatar"
                      />
                      <div className="follow-request-info">
                        <span className="follow-request-name">
                          {request.user.displayName || request.user.username}
                        </span>
                        <span className="follow-request-username">
                          @{request.user.username}
                        </span>
                        <span className="follow-request-time">
                          {formatDate(new Date(request.createdAt))}
                        </span>
                      </div>
                    </Link>

                    <div className="follow-request-actions">
                      <button
                        className="follow-request-approve"
                        onClick={() => handleApprove(request.id)}
                        disabled={processing === request.id}
                        aria-label="Approve request"
                      >
                        {processing === request.id ? (
                          <span className="btn-spinner" />
                        ) : (
                          <CheckIcon />
                        )}
                      </button>
                      <button
                        className="follow-request-reject"
                        onClick={() => handleReject(request.id)}
                        disabled={processing === request.id}
                        aria-label="Reject request"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {hasMore && (
                <button
                  className="follow-requests-load-more"
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

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
