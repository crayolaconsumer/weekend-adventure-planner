/**
 * Error Reporting Utility
 *
 * Centralized error reporting. Currently logs to console.
 *
 * To enable Sentry:
 * 1. npm install @sentry/react
 * 2. Add VITE_SENTRY_DSN to environment
 * 3. Uncomment the Sentry initialization and captureException calls
 */

// Uncomment when Sentry is configured:
// import * as Sentry from '@sentry/react'

// Initialize Sentry (uncomment when ready)
// if (import.meta.env.VITE_SENTRY_DSN) {
//   Sentry.init({
//     dsn: import.meta.env.VITE_SENTRY_DSN,
//     environment: import.meta.env.MODE,
//     tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
//     integrations: [
//       Sentry.browserTracingIntegration(),
//     ],
//   })
// }

/**
 * Report an error to the error tracking service
 * @param {Error} error - The error to report
 * @param {Object} [context={}] - Additional context (component, user action, etc.)
 */
export function reportError(error, context = {}) {
  // Always log to console in development
  if (import.meta.env.DEV) {
    console.error('Error reported:', error)
    if (Object.keys(context).length > 0) {
      console.error('Context:', context)
    }
  }

  // Send to Sentry in production (uncomment when configured)
  // if (import.meta.env.VITE_SENTRY_DSN) {
  //   Sentry.captureException(error, {
  //     extra: {
  //       ...context,
  //       url: window.location.href,
  //       timestamp: new Date().toISOString()
  //     }
  //   })
  // }

  // Optionally send to custom error endpoint
  // This can be useful for aggregating errors without a third-party service
  if (import.meta.env.PROD && !import.meta.env.VITE_SENTRY_DSN) {
    // Could POST to /api/errors endpoint
    // fetch('/api/errors', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     message: error.message,
    //     stack: error.stack,
    //     context,
    //     url: window.location.href,
    //     timestamp: new Date().toISOString()
    //   })
    // }).catch(() => {})
  }
}

/**
 * Report a message (non-error) to the tracking service
 * @param {string} message - The message to report
 * @param {'info'|'warning'|'error'} [level='info'] - Severity level
 * @param {Object} [context={}] - Additional context
 */
export function reportMessage(message, level = 'info', context = {}) {
  const logFn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log

  if (import.meta.env.DEV) {
    logFn(`[${level.toUpperCase()}]`, message, context)
  }

  // Sentry.captureMessage(message, { level, extra: context })
}

/**
 * Set user context for error reports
 * @param {Object|null} user - User object (null to clear)
 */
export function setUser(user) {
  if (user) {
    // Sentry.setUser({
    //   id: user.id,
    //   username: user.username,
    //   email: user.email
    // })
    if (import.meta.env.DEV) {
      console.log('Error reporting user context set:', { id: user.id, username: user.username })
    }
  } else {
    // Sentry.setUser(null)
    if (import.meta.env.DEV) {
      console.log('Error reporting user context cleared')
    }
  }
}

export default {
  reportError,
  reportMessage,
  setUser
}
