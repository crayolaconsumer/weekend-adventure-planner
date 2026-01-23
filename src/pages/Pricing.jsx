import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import './Pricing.css'

// Check icon
const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

// X icon
const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// Sparkle icon for premium
const SparkleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
  </svg>
)

const FEATURES = [
  { key: 'discover', label: 'Unlimited discovery', free: true, premium: true },
  { key: 'community', label: 'See community tips', free: true, premium: true },
  { key: 'saves', label: 'Save places', free: '10 places', premium: 'Unlimited' },
  { key: 'collections', label: 'Collections', free: '3 max', premium: 'Unlimited' },
  { key: 'whoSaved', label: 'See who saved same places', free: false, premium: true },
  { key: 'filters', label: 'Advanced filters', free: 'Basic', premium: 'All' },
  { key: 'offline', label: 'Offline maps', free: false, premium: true },
  { key: 'adFree', label: 'Ad-free experience', free: false, premium: true },
  { key: 'export', label: 'Export adventures (PDF/iCal)', free: false, premium: true },
  { key: 'earlyAccess', label: 'Early access to new features', free: false, premium: true }
]

export default function Pricing() {
  const { user } = useAuth()
  const { isPremium, startCheckout, loading, error } = useSubscription()
  const [billingPeriod, setBillingPeriod] = useState('annual') // 'monthly' | 'annual'

  const monthlyPrice = 4.99
  const annualPrice = 39.99
  const annualMonthly = (annualPrice / 12).toFixed(2)
  const savingsPercent = Math.round((1 - annualPrice / (monthlyPrice * 12)) * 100)

  const openAuthModal = useCallback((mode = 'signup') => {
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode } }))
  }, [])

  const handleUpgrade = async () => {
    if (!user) {
      openAuthModal('signup')
      return
    }

    const plan = billingPeriod === 'annual' ? 'premium_annual' : 'premium_monthly'
    await startCheckout(plan)
  }

  const renderFeatureValue = (value) => {
    if (value === true) {
      return <span className="feature-check"><CheckIcon /></span>
    }
    if (value === false) {
      return <span className="feature-x"><XIcon /></span>
    }
    return <span className="feature-text">{value}</span>
  }

  return (
    <div className="page pricing-page">
      <div className="pricing-container">
        {/* Header */}
        <motion.div
          className="pricing-header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1>Unlock ROAM+</h1>
          <p>Discover more, save more, explore without limits</p>
        </motion.div>

        {/* Billing toggle */}
        <motion.div
          className="billing-toggle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <button
            className={`billing-option ${billingPeriod === 'monthly' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('monthly')}
          >
            Monthly
          </button>
          <button
            className={`billing-option ${billingPeriod === 'annual' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('annual')}
          >
            Annual
            <span className="savings-badge">Save {savingsPercent}%</span>
          </button>
        </motion.div>

        {/* Pricing cards */}
        <div className="pricing-cards">
          {/* Free tier */}
          <motion.div
            className="pricing-card free"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="pricing-card-header">
              <h2>Free</h2>
              <div className="pricing-price">
                <span className="price-amount">£0</span>
                <span className="price-period">forever</span>
              </div>
              <p className="pricing-description">Perfect for casual explorers</p>
            </div>

            <ul className="pricing-features">
              {FEATURES.map(feature => (
                <li key={feature.key} className="pricing-feature">
                  {renderFeatureValue(feature.free)}
                  <span>{feature.label}</span>
                </li>
              ))}
            </ul>

            <div className="pricing-card-footer">
              {user ? (
                <button className="pricing-btn secondary" disabled>
                  Current Plan
                </button>
              ) : (
                <button
                  className="pricing-btn secondary"
                  onClick={() => openAuthModal?.('signup')}
                >
                  Get Started
                </button>
              )}
            </div>
          </motion.div>

          {/* Premium tier */}
          <motion.div
            className="pricing-card premium"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="pricing-card-badge">
              <SparkleIcon />
              Most Popular
            </div>

            <div className="pricing-card-header">
              <h2>ROAM+</h2>
              <div className="pricing-price">
                <span className="price-amount">
                  £{billingPeriod === 'annual' ? annualMonthly : monthlyPrice.toFixed(2)}
                </span>
                <span className="price-period">/month</span>
              </div>
              {billingPeriod === 'annual' && (
                <p className="pricing-billed">Billed annually at £{annualPrice}</p>
              )}
              <p className="pricing-description">For serious adventurers</p>
            </div>

            <ul className="pricing-features">
              {FEATURES.map(feature => (
                <li key={feature.key} className="pricing-feature">
                  {renderFeatureValue(feature.premium)}
                  <span>{feature.label}</span>
                </li>
              ))}
            </ul>

            <div className="pricing-card-footer">
              {isPremium ? (
                <button className="pricing-btn primary" disabled>
                  Current Plan
                </button>
              ) : (
                <button
                  className="pricing-btn primary"
                  onClick={handleUpgrade}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Start 7-day free trial'}
                </button>
              )}
              {error && <p className="pricing-error">{error}</p>}
              <p className="pricing-trial-note">Cancel anytime during trial</p>
            </div>
          </motion.div>
        </div>

        {/* Social proof */}
        <motion.div
          className="pricing-social-proof"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <p>Join thousands of adventurers exploring with ROAM+</p>
        </motion.div>

        {/* FAQ */}
        <motion.div
          className="pricing-faq"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <h3>Questions?</h3>
          <div className="faq-grid">
            <div className="faq-item">
              <h4>Can I cancel anytime?</h4>
              <p>Yes! Cancel your subscription at any time. You'll keep premium access until the end of your billing period.</p>
            </div>
            <div className="faq-item">
              <h4>What happens to my saved places?</h4>
              <p>If you downgrade, you keep all your saved places. You just won't be able to save more than 10 until you upgrade again.</p>
            </div>
            <div className="faq-item">
              <h4>Is there a free trial?</h4>
              <p>Yes! Get 7 days free to try all premium features. Cancel before the trial ends and you won't be charged.</p>
            </div>
            <div className="faq-item">
              <h4>How do I manage my subscription?</h4>
              <p>Go to your Profile page and click "Manage Subscription" to update payment methods or cancel.</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
