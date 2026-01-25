/**
 * NotificationBell Component
 *
 * Floating notification bell with "Dispatches from the Trail" themed panel
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { useNotifications } from '../hooks/useNotifications'
import { useAuth } from '../contexts/AuthContext'
import { formatDistanceToNow } from '../utils/dateUtils'
import './NotificationBell.css'

// Icons
const BellIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

const CompassIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88"/>
  </svg>
)

// Type icons for different notification types
const TypeIcons = {
  follow: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/>
      <line x1="22" y1="11" x2="16" y2="11"/>
    </svg>
  ),
  follow_request_approved: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20,6 9,17 4,12"/>
    </svg>
  ),
  contribution_upvote: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18,15 12,9 6,15"/>
    </svg>
  ),
  plan_shared: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2"/>
      <line x1="8" y1="2" x2="8" y2="18"/>
      <line x1="16" y1="6" x2="16" y2="22"/>
    </svg>
  ),
  default: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  )
}

// Empty state illustration
const EnvelopeIllustration = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="envelope-illustration">
    <rect x="8" y="16" width="48" height="36" rx="2" stroke="var(--roam-stone)"/>
    <polyline points="8,18 32,38 56,18" stroke="var(--roam-stone)"/>
    <line x1="8" y1="52" x2="24" y2="36" stroke="var(--roam-parchment-dark)"/>
    <line x1="56" y1="52" x2="40" y2="36" stroke="var(--roam-parchment-dark)"/>
  </svg>
)

export default function NotificationBell() {
  const { isAuthenticated } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)
  const dragControls = useDragControls()
  const {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadMore,
    markAsRead,
    markAllAsRead
  } = useNotifications()

  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 480)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Mark visible notifications as read when panel opens
  useEffect(() => {
    if (isOpen && notifications.length > 0) {
      const unreadIds = notifications
        .filter(n => !n.isRead)
        .slice(0, 5)
        .map(n => n.id)

      if (unreadIds.length > 0) {
        const timer = setTimeout(() => {
          markAsRead(unreadIds)
        }, 2000)
        return () => clearTimeout(timer)
      }
    }
  }, [isOpen, notifications, markAsRead])

  // Handle drag end for mobile bottom sheet
  const handleDragEnd = useCallback((_, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      setIsOpen(false)
    }
  }, [])

  const handleToggle = () => {
    setIsOpen(!isOpen)
  }

  // Only show for authenticated users
  if (!isAuthenticated) return null

  // Panel animation variants
  const panelVariants = isMobile
    ? {
        initial: { y: '100%', opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: '100%', opacity: 0 }
      }
    : {
        initial: { opacity: 0, y: 10, scale: 0.95 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 10, scale: 0.95 }
      }

  return (
    <div className="notification-floating-container">
      {/* Floating Bell Button */}
      <button
        ref={buttonRef}
        className={`notification-bell-btn ${unreadCount > 0 ? 'has-unread' : ''}`}
        onClick={handleToggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Mobile backdrop */}
      <AnimatePresence>
        {isOpen && isMobile && (
          <motion.div
            className="notification-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Notification Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            className={`notification-panel ${isMobile ? 'mobile' : ''}`}
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{
              type: 'spring',
              damping: 25,
              stiffness: 300
            }}
            drag={isMobile ? 'y' : false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag handle for mobile */}
            {isMobile && (
              <div
                className="notification-drag-handle"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="notification-drag-pill" />
              </div>
            )}

            {/* Header */}
            <div className="notification-panel-header">
              <div className="notification-panel-title">
                <CompassIcon />
                <h3>Dispatches</h3>
              </div>
              {unreadCount > 0 && (
                <button
                  className="notification-mark-all"
                  onClick={markAllAsRead}
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* Content */}
            <div className="notification-panel-content">
              {loading && notifications.length === 0 ? (
                <div className="notification-loading">
                  <SkeletonItem />
                  <SkeletonItem />
                  <SkeletonItem />
                </div>
              ) : notifications.length === 0 ? (
                <div className="notification-empty">
                  <EnvelopeIllustration />
                  <p className="notification-empty-title">No dispatches yet</p>
                  <p className="notification-empty-subtitle">
                    When fellow explorers interact with you, you'll see it here
                  </p>
                </div>
              ) : (
                <>
                  {notifications.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onClose={() => setIsOpen(false)}
                    />
                  ))}

                  {hasMore && (
                    <button
                      className="notification-load-more"
                      onClick={loadMore}
                      disabled={loading}
                    >
                      {loading ? 'Loading...' : 'Load more dispatches'}
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Loading skeleton item
function SkeletonItem() {
  return (
    <div className="notification-skeleton">
      <div className="notification-skeleton-avatar" />
      <div className="notification-skeleton-content">
        <div className="notification-skeleton-line" />
        <div className="notification-skeleton-line short" />
      </div>
    </div>
  )
}

// Individual notification item
function NotificationItem({ notification, onClose }) {
  const avatarUrl = notification.actor?.avatarUrl ||
    (notification.actor?.displayName || notification.actor?.username
      ? `https://ui-avatars.com/api/?name=${encodeURIComponent(notification.actor?.displayName || notification.actor?.username)}&background=E07A5F&color=fff`
      : null)

  const timeAgo = formatDistanceToNow(new Date(notification.createdAt))

  // Get the appropriate type icon
  const TypeIcon = TypeIcons[notification.type] || TypeIcons.default

  // Determine link and action text based on notification type
  const getNotificationMeta = () => {
    switch (notification.type) {
      case 'follow':
        return {
          link: notification.actor?.username ? `/user/${notification.actor.username}` : null,
          actionText: 'View Profile'
        }
      case 'follow_request_approved':
        return {
          link: notification.actor?.username ? `/user/${notification.actor.username}` : null,
          actionText: 'View Profile'
        }
      case 'contribution_upvote':
        return {
          link: notification.referenceId ? `/place/${notification.referenceId}` : null,
          actionText: 'See Place'
        }
      case 'plan_shared':
        return {
          link: notification.referenceId ? `/plan/share/${notification.referenceId}` : null,
          actionText: 'View Plan'
        }
      default:
        return { link: null, actionText: null }
    }
  }

  const { link, actionText } = getNotificationMeta()

  const content = (
    <>
      <div className="notification-item-left">
        {avatarUrl && (
          <img
            src={avatarUrl}
            alt=""
            className="notification-item-avatar"
          />
        )}
        <div className="notification-item-type-icon">
          <TypeIcon />
        </div>
      </div>
      <div className="notification-item-body">
        <div className="notification-item-header">
          <span className="notification-item-time">{timeAgo}</span>
        </div>
        <p className="notification-item-message">{notification.message}</p>
        {actionText && (
          <span className="notification-item-action">{actionText} →</span>
        )}
      </div>
    </>
  )

  const className = `notification-item ${!notification.isRead ? 'unread' : ''}`

  if (link) {
    return (
      <Link to={link} className={className} onClick={onClose}>
        {content}
      </Link>
    )
  }

  return <div className={className}>{content}</div>
}
