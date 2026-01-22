/**
 * Date utility functions
 */

/**
 * Format a date as relative time (e.g., "2 hours ago", "3 days ago")
 * @param {Date} date - The date to format
 * @returns {string} - Human readable relative time
 */
export function formatDistanceToNow(date) {
  const now = new Date()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (seconds < 60) {
    return 'just now'
  } else if (minutes < 60) {
    return `${minutes}m ago`
  } else if (hours < 24) {
    return `${hours}h ago`
  } else if (days < 7) {
    return `${days}d ago`
  } else if (weeks < 4) {
    return `${weeks}w ago`
  } else if (months < 12) {
    return `${months}mo ago`
  } else {
    return `${years}y ago`
  }
}

/**
 * Format a date in a readable format
 * @param {Date} date - The date to format
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} - Formatted date string
 */
export function formatDate(date, options = {}) {
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options
  }
  return new Intl.DateTimeFormat('en-GB', defaultOptions).format(date)
}

/**
 * Format a date with time
 * @param {Date} date - The date to format
 * @returns {string} - Formatted date and time string
 */
export function formatDateTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

/**
 * Check if a date is today
 * @param {Date} date - The date to check
 * @returns {boolean}
 */
export function isToday(date) {
  const today = new Date()
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  )
}

/**
 * Get the start of day for a date
 * @param {Date} date - The date
 * @returns {Date}
 */
export function startOfDay(date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}
