/**
 * Error Reporting Utility
 *
 * Conditional Sentry — activates only when VITE_SENTRY_DSN is set in the
 * environment. Without the DSN, all calls are silent no-ops, so dev /
 * preview deployments don't send noise upstream.
 *
 * Usage:
 *   1. Set VITE_SENTRY_DSN in Vercel env (Project → Settings → Env Vars)
 *   2. Redeploy. No code changes needed.
 *   3. Init runs automatically from main.jsx via initObservability()
 */

import * as Sentry from '@sentry/react'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'

let initialized = false

/**
 * Initialize Sentry. Safe to call multiple times — second call is a no-op.
 * Called once from main.jsx before React renders.
 */
export function initObservability() {
  if (initialized) return
  if (!SENTRY_DSN) return

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: APP_VERSION,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,
    replaysSessionSampleRate: 0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        /* Mask user-readable text + media in session replays so error
           recordings don't ship reviews/photos/display-names to Sentry.
           Required for accurate privacy nutrition label disclosure. */
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // Don't capture noise from extensions or third-party scripts
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
    ],
  })

  initialized = true
}

/**
 * Identify the current user to Sentry. Call after login.
 */
export function identifyUser({ id, username, email } = {}) {
  if (!initialized) return
  Sentry.setUser(id ? { id: String(id), username, email } : null)
}

/**
 * Clear user context. Call on logout.
 */
export function clearUser() {
  if (!initialized) return
  Sentry.setUser(null)
}

/**
 * Add a breadcrumb (small contextual event) — Sentry shows the last
 * ~100 of these alongside any captured exception.
 */
export function addBreadcrumb({ category, message, level = 'info', data } = {}) {
  if (!initialized) return
  Sentry.addBreadcrumb({ category, message, level, data })
}

/**
 * Report an error to the error tracking service.
 * @param {Error|string} error - The error to report
 * @param {Object} [context={}] - Additional context (component, user action, etc.)
 */
export function reportError(error, context = {}) {
  // Always log to console in development for instant feedback
  if (import.meta.env.DEV) {
    console.error('Error reported:', error)
    if (Object.keys(context).length > 0) {
      console.error('Context:', context)
    }
  }

  if (!initialized) return

  const err = error instanceof Error ? error : new Error(String(error))
  Sentry.captureException(err, {
    extra: {
      ...context,
      url: typeof window !== 'undefined' ? window.location.href : null,
      timestamp: new Date().toISOString(),
    },
  })
}

/**
 * Capture a non-error message (info / warning) — useful for tracking
 * unusual states that aren't crashes but worth investigating.
 */
export function reportMessage(message, level = 'info', context = {}) {
  if (import.meta.env.DEV) {
    const logFn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log
    logFn(`[${level.toUpperCase()}]`, message, context)
  }
  if (!initialized) return
  Sentry.captureMessage(message, { level, extra: context })
}

export default {
  initObservability,
  identifyUser,
  clearUser,
  addBreadcrumb,
  reportError,
  reportMessage,
}
