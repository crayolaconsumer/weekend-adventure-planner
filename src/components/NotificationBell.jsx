/**
 * NotificationBell Component
 *
 * Notification bell icon with dropdown panel
 */

import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useNotifications } from '../hooks/useNotifications'
import { formatDistanceToNow } from '../utils/dateUtils'
import './NotificationBell.css'

const BellIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)
  const {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadMore,
    markAsRead,
    markAllAsRead
  } = useNotifications()

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
        // Delay marking as read for better UX
        const timer = setTimeout(() => {
          markAsRead(unreadIds)
        }, 2000)
        return () => clearTimeout(timer)
      }
    }
  }, [isOpen, notifications, markAsRead])

  const handleToggle = () => {
    setIsOpen(!isOpen)
  }

  return (
    <div className="notification-bell">
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

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            className="notification-panel"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <div className="notification-panel-header">
              <h3>Notifications</h3>
              {unreadCount > 0 && (
                <button
                  className="notification-mark-all"
                  onClick={markAllAsRead}
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="notification-panel-content">
              {loading && notifications.length === 0 ? (
                <div className="notification-loading">
                  <div className="notification-spinner" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="notification-empty">
                  <span className="notification-empty-icon">🔔</span>
                  <p>No notifications yet</p>
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
                      {loading ? 'Loading...' : 'Load more'}
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

function NotificationItem({ notification, onClose }) {
  const avatarUrl = notification.actor?.avatarUrl ||
    (notification.actor?.displayName || notification.actor?.username
      ? `https://ui-avatars.com/api/?name=${encodeURIComponent(notification.actor?.displayName || notification.actor?.username)}&background=E07A5F&color=fff`
      : null)

  const timeAgo = formatDistanceToNow(new Date(notification.createdAt))

  // Determine link based on notification type
  const getLink = () => {
    switch (notification.type) {
      case 'follow':
        return notification.actor?.username ? `/user/${notification.actor.username}` : null
      default:
        return null
    }
  }

  const link = getLink()
  const content = (
    <>
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          className="notification-item-avatar"
        />
      )}
      <div className="notification-item-content">
        <p className="notification-item-message">{notification.message}</p>
        <span className="notification-item-time">{timeAgo}</span>
      </div>
      {!notification.isRead && <span className="notification-item-dot" />}
    </>
  )

  if (link) {
    return (
      <Link
        to={link}
        className={`notification-item ${!notification.isRead ? 'unread' : ''}`}
        onClick={onClose}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={`notification-item ${!notification.isRead ? 'unread' : ''}`}>
      {content}
    </div>
  )
}
