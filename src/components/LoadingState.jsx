/**
 * LoadingState Component
 *
 * Standardized loading states for consistent UX across the app.
 * Supports multiple variants: spinner, skeleton, and card-stack.
 */

import { motion } from 'framer-motion'
import './LoadingState.css'

const CompassIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88"/>
  </svg>
)

const LOADING_MESSAGES = [
  'Discovering places nearby...',
  'Finding hidden gems...',
  'Exploring the map...',
  'Almost there...'
]

/**
 * Spinner variant - centered loading indicator
 */
function SpinnerLoader({ message, size = 'medium' }) {
  return (
    <div className={`loading-state loading-state-spinner loading-state-${size}`} role="status" aria-live="polite">
      <motion.div
        className="loading-spinner-icon"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      >
        <CompassIcon />
      </motion.div>
      {message && <p className="loading-message">{message}</p>}
      <span className="visually-hidden">Loading content</span>
    </div>
  )
}

/**
 * Skeleton variant - placeholder shapes
 */
function SkeletonLoader({ lines = 3, type = 'text' }) {
  if (type === 'card') {
    return (
      <div className="loading-state loading-state-skeleton" role="status" aria-live="polite">
        <div className="skeleton-card">
          <div className="skeleton-image" />
          <div className="skeleton-content">
            <div className="skeleton-line" style={{ width: '70%' }} />
            <div className="skeleton-line" style={{ width: '50%' }} />
          </div>
        </div>
        <span className="visually-hidden">Loading content</span>
      </div>
    )
  }

  if (type === 'cards') {
    return (
      <div className="loading-state loading-state-skeleton-cards" role="status" aria-live="polite">
        {[0, 1, 2].map(i => (
          <div key={i} className="skeleton-mini-card" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
        <span className="visually-hidden">Loading content</span>
      </div>
    )
  }

  return (
    <div className="loading-state loading-state-skeleton" role="status" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
      <span className="visually-hidden">Loading content</span>
    </div>
  )
}

/**
 * Card stack variant - used for main discovery page
 */
function CardStackLoader({ messages = LOADING_MESSAGES }) {
  return (
    <div className="loading-state loading-state-card-stack" role="status" aria-live="polite">
      <motion.div
        className="card-stack-loader-icon"
        animate={{ rotate: [0, 45, -30, 15, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <CompassIcon />
      </motion.div>

      <div className="card-stack-loader-cards">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="loader-card"
            style={{
              transform: `scale(${1 - i * 0.04}) translateY(${i * 10}px)`,
              opacity: 1 - i * 0.3,
              zIndex: 3 - i,
              animationDelay: `${i * 0.15}s`
            }}
          />
        ))}
      </div>

      <motion.p
        className="card-stack-loader-text"
        key={messages[0]}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {messages[0]}
      </motion.p>
      <span className="visually-hidden">Loading places</span>
    </div>
  )
}

/**
 * Inline loader - for buttons and small spaces
 */
function InlineLoader({ size = 'small' }) {
  return (
    <span className={`loading-inline loading-inline-${size}`} role="status" aria-live="polite">
      <span className="loading-dot" />
      <span className="loading-dot" />
      <span className="loading-dot" />
      <span className="visually-hidden">Loading</span>
    </span>
  )
}

/**
 * Full page loader - for initial app load
 */
function FullPageLoader({ message = 'Loading...' }) {
  return (
    <div className="loading-state loading-state-fullpage" role="status" aria-live="polite">
      <motion.div
        className="fullpage-loader-icon"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      >
        <CompassIcon />
      </motion.div>
      <p className="fullpage-loader-text">{message}</p>
      <span className="visually-hidden">{message}</span>
    </div>
  )
}

// Main export with variants
export default function LoadingState({ variant = 'spinner', ...props }) {
  switch (variant) {
    case 'spinner':
      return <SpinnerLoader {...props} />
    case 'skeleton':
      return <SkeletonLoader {...props} />
    case 'card-stack':
      return <CardStackLoader {...props} />
    case 'inline':
      return <InlineLoader {...props} />
    case 'fullpage':
      return <FullPageLoader {...props} />
    default:
      return <SpinnerLoader {...props} />
  }
}

// Named exports for direct imports
export { SpinnerLoader, SkeletonLoader, CardStackLoader, InlineLoader, FullPageLoader }
