import { motion } from 'framer-motion'

/**
 * Map a Discover load-error string to a user-facing recovery config.
 * Pure — pulled out so the error-class detection is testable in isolation
 * (see tests/unit/pages/Discover.ErrorRecovery.test.ts). Kept in this
 * file so the recovery component and its classifier evolve together.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function classifyLoadError(loadError) {
  if (!loadError || typeof loadError !== 'string') {
    return {
      kind: 'generic',
      title: 'Something went wrong',
      message: "We couldn't load places near you. This might be a temporary issue.",
    }
  }

  const lower = loadError.toLowerCase()

  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch')) {
    return {
      kind: 'network',
      title: "Can't reach the internet",
      message: 'Check your connection and try again.',
    }
  }

  if (lower.includes('timeout')) {
    return {
      kind: 'timeout',
      title: 'Taking too long',
      message: 'The request is taking longer than expected. Try reducing your travel radius or selecting fewer categories.',
    }
  }

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many')) {
    return {
      kind: 'rate_limit',
      title: 'Too many requests',
      message: 'Wait a moment, then try again.',
    }
  }

  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('server')) {
    return {
      kind: 'server',
      title: 'Places are unavailable right now',
      message: 'Our servers are busy. Try again in a minute.',
    }
  }

  return {
    kind: 'generic',
    title: 'Something went wrong',
    message: "We couldn't load places near you. This might be a temporary issue.",
  }
}

/**
 * Determine the primary + secondary action for an error class.
 * Primary always retries; secondary opens filters where reducing scope
 * is a plausible fix. For rate-limit, delay before retry so the
 * exponential-backoff isn't immediately tripped again.
 */
function actionsForError({ kind }, { onRetry, onOpenFilters }) {
  const primary = (() => {
    switch (kind) {
      case 'network':
        return { label: 'Try again', onClick: onRetry }
      case 'rate_limit':
        return { label: 'Wait and try again', onClick: () => setTimeout(onRetry, 3000) }
      default:
        return { label: 'Try again', onClick: onRetry }
    }
  })()

  const secondary = (() => {
    switch (kind) {
      case 'generic':
        return { label: 'Check filters', onClick: onOpenFilters }
      case 'timeout':
        return { label: 'Reduce radius', onClick: onOpenFilters }
      default:
        return null
    }
  })()

  return { primary, secondary }
}

/**
 * Error recovery panel shown when Discover fails to load any places.
 * Picks user-friendly copy + actions based on the error class.
 */
export default function ErrorRecovery({ loadError, onRetry, onOpenFilters }) {
  const config = classifyLoadError(loadError)
  const { primary, secondary } = actionsForError(config, { onRetry, onOpenFilters })

  return (
    <motion.div
      className="discover-error-recovery"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h3>{config.title}</h3>
      <p>{config.message}</p>
      <div className="discover-error-actions">
        <button className="discover-error-retry" onClick={primary.onClick}>
          {primary.label}
        </button>
        {secondary && (
          <button className="discover-error-settings" onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    </motion.div>
  )
}
