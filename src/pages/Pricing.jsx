import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { PRICING } from '../constants/pricing'
import PremiumBadge from '../components/PremiumBadge'
import { track } from '../utils/analytics'
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

// (legacy SparkleIcon dropped — replaced by PremiumBadge component for brand consistency)

// Outcome-led copy. Each row reads as a thing the user gets to do, not
// a feature checkbox. Free column shows the ceiling; ROAM+ shows freedom.
const FEATURES = [
  { key: 'discover', label: 'Discover places near you', free: true, premium: true },
  { key: 'community', label: 'See what locals recommend', free: true, premium: true },
  { key: 'saves', label: 'Save places to revisit', free: '10', premium: 'Unlimited' },
  { key: 'collections', label: 'Build themed lists', free: '3', premium: 'Unlimited' },
  { key: 'whoSaved', label: 'See who shares your taste', free: false, premium: true },
  { key: 'filters', label: 'Find exactly what you want', free: 'Basic', premium: 'All filters' },
  { key: 'radius', label: 'Reach further afield', free: 'Up to 30km', premium: 'Up to 150km' },
  { key: 'offline', label: 'Explore when signal drops', free: false, premium: 'Offline maps' },
  { key: 'adFree', label: 'Distraction-free browsing', free: false, premium: 'No ads, ever' },
  { key: 'export', label: 'Keep your adventures forever', free: false, premium: 'Posters & calendar export' },
  { key: 'earlyAccess', label: 'Try new features first', free: false, premium: true }
]

export default function Pricing() {
  const { user } = useAuth()
  const { isPremium, startCheckout, loading, error } = useSubscription()
  const [billingPeriod, setBillingPeriod] = useState('annual') // 'monthly' | 'annual'

  const monthlyPrice = PRICING.monthly
  const annualPrice = PRICING.annual
  const annualMonthly = (annualPrice / 12).toFixed(2)
  const savingsPercent = Math.round((1 - annualPrice / (monthlyPrice * 12)) * 100)

  const openAuthModal = useCallback((mode = 'signup') => {
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode } }))
  }, [])

  const handleUpgrade = async () => {
    if (!user) {
      track('upgrade-clicked', { plan: billingPeriod, surface: 'pricing-page', authed: false })
      openAuthModal('signup')
      return
    }

    const plan = billingPeriod === 'annual' ? 'premium_annual' : 'premium_monthly'
    track('upgrade-clicked', { plan: billingPeriod, surface: 'pricing-page', authed: true })
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
          <h1>Make every weekend matter.</h1>
          <p className="pricing-hero-sub">
            Unlimited saves. Offline-ready maps. No ads. <strong>Less than the price of a pint a month.</strong>
          </p>
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
              <p className="pricing-description">Try ROAM and start your map.</p>
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
              <PremiumBadge size="md" showBevel={false} />
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
              {billingPeriod === 'annual' ? (
                <p className="pricing-billed">Billed annually — £{annualPrice}/year (save {savingsPercent}%)</p>
              ) : (
                <p className="pricing-billed">Billed monthly. Switch to annual any time and save {savingsPercent}%.</p>
              )}
              <p className="pricing-description">Everything in Free, plus the freedom to roam without limits.</p>
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
              <p className="pricing-trial-note">7 days free, then £{billingPeriod === 'annual' ? annualPrice : monthlyPrice.toFixed(2)}{billingPeriod === 'annual' ? '/year' : '/month'}. Cancel anytime in the trial — no charge.</p>
            </div>
          </motion.div>
        </div>

        {/* Trust strip */}
        <motion.div
          className="pricing-trust-strip"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <div className="pricing-trust-item">
            <strong>Secure</strong>
            <span>Stripe handles payments — your card never touches our servers.</span>
          </div>
          <div className="pricing-trust-item">
            <strong>Fair</strong>
            <span>Cancel from your phone in two taps. We&apos;ll never trick you into renewing.</span>
          </div>
          <div className="pricing-trust-item">
            <strong>Indie</strong>
            <span>Built by one person who actually wants you to get out more.</span>
          </div>
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
              <h4>Can I cancel during the trial?</h4>
              <p>Yes — cancel from your phone in two taps. You won&apos;t be charged a penny.</p>
            </div>
            <div className="faq-item">
              <h4>What happens to my saved places if I downgrade?</h4>
              <p>You keep them all. You just won&apos;t be able to add new ones beyond 10 until you upgrade again.</p>
            </div>
            <div className="faq-item">
              <h4>Is my payment secure?</h4>
              <p>Yes. All payments are handled by Stripe. We never see your card details.</p>
            </div>
            <div className="faq-item">
              <h4>Will my price ever go up?</h4>
              <p>If you stay subscribed, your price stays the same. If we ever raise prices for new subscribers, you&apos;re grandfathered in.</p>
            </div>
            <div className="faq-item">
              <h4>What does the badge do?</h4>
              <p>ROAM+ subscribers get a scout-style badge on their profile and activity. It&apos;s small but cool.</p>
            </div>
            <div className="faq-item">
              <h4>How do I manage my subscription?</h4>
              <p>Go to Settings → Manage Subscription to update payment or cancel.</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
