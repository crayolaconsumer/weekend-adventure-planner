import { useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { PRICING } from '../constants/pricing'
import './UpgradePrompt.css'

// Sparkle icon
const SparkleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
  </svg>
)

// Close icon
const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// Prompt configurations for different friction points
const PROMPT_CONFIGS = {
  saves: {
    icon: '💾',
    title: 'Save limit reached',
    description: "You've saved 10 places! Upgrade to ROAM+ for unlimited saves.",
    cta: 'Unlock Unlimited Saves',
    benefit: 'Never lose a discovery again'
  },
  collections: {
    icon: '📁',
    title: 'Collection limit reached',
    description: "You've created 3 collections. Upgrade to organize unlimited adventures.",
    cta: 'Unlock Unlimited Collections',
    benefit: 'Organize your world, your way'
  },
  offline: {
    icon: '📴',
    title: 'Offline maps are a premium feature',
    description: 'Download maps to explore without internet. Perfect for adventures off the beaten path.',
    cta: 'Get Offline Maps',
    benefit: 'Explore anywhere, anytime'
  },
  export: {
    icon: '📤',
    title: 'Export is a premium feature',
    description: 'Export your adventures as PDF or add to your calendar.',
    cta: 'Unlock Exports',
    benefit: 'Share and plan with ease'
  },
  filters: {
    icon: '🔍',
    title: 'Advanced filters',
    description: 'Get access to all filtering options to find exactly what you want.',
    cta: 'Unlock All Filters',
    benefit: 'Find your perfect spot'
  }
}

export default function UpgradePrompt({
  type = 'saves',
  isOpen = false,
  onClose,
  onUpgrade
}) {
  const { user } = useAuth()
  const { startCheckout, loading, error } = useSubscription()

  const config = PROMPT_CONFIGS[type] || PROMPT_CONFIGS.saves

  const openAuthModal = useCallback((mode = 'signup') => {
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode } }))
  }, [])

  const handleUpgrade = async () => {
    if (!user) {
      openAuthModal('signup')
      onClose?.()
      return
    }

    const url = await startCheckout('premium_monthly')
    // Only call onUpgrade if checkout succeeded (URL returned means redirect happening)
    if (url) {
      onUpgrade?.()
    }
    // If no URL returned, error state is set - modal stays open showing error
  }

  const handleClose = () => {
    onClose?.()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="upgrade-prompt-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          >
            {/* Modal */}
            <motion.div
              className="upgrade-prompt"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={event => event.stopPropagation()}
            >
              {/* Close button */}
              <button className="upgrade-prompt-close" onClick={handleClose}>
                <CloseIcon />
              </button>

              {/* Content */}
              <div className="upgrade-prompt-content">
                <div className="upgrade-prompt-icon">
                  <span className="upgrade-prompt-emoji">{config.icon}</span>
                  <span className="upgrade-prompt-sparkle"><SparkleIcon /></span>
                </div>

                <h2 className="upgrade-prompt-title">{config.title}</h2>
                <p className="upgrade-prompt-description">{config.description}</p>

                {/* Benefits */}
                <div className="upgrade-prompt-benefits">
                  <div className="upgrade-prompt-benefit">
                    <span className="benefit-check">✓</span>
                    {config.benefit}
                  </div>
                  <div className="upgrade-prompt-benefit">
                    <span className="benefit-check">✓</span>
                    Ad-free experience
                  </div>
                  <div className="upgrade-prompt-benefit">
                    <span className="benefit-check">✓</span>
                    7-day free trial
                  </div>
                </div>

                {/* CTA */}
                <motion.button
                  className="upgrade-prompt-cta"
                  onClick={handleUpgrade}
                  disabled={loading}
                  whileHover={loading ? {} : { scale: 1.02 }}
                  whileTap={loading ? {} : { scale: 0.98 }}
                >
                  {loading ? 'Loading...' : config.cta}
                </motion.button>

                {/* Secondary action */}
                <button className="upgrade-prompt-secondary" onClick={handleClose}>
                  Maybe later
                </button>

                {/* Price note */}
                <p className="upgrade-prompt-price">
                  Just {PRICING.currency}{PRICING.monthly}/month after free trial
                </p>

                {/* Error display */}
                {error && (
                  <p className="upgrade-prompt-error">{error}</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
