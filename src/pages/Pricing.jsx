import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { PRICING } from '../constants/pricing'
import PremiumBadge from '../components/PremiumBadge'
import { track } from '../utils/analytics'
import { isIosNative, isNative } from '../utils/nativeBridge'
import { openExternalUrl } from '../utils/nativePlugins'
import {
  getOfferings as rcGetOfferings,
  purchasePackage as rcPurchasePackage,
  restorePurchases as rcRestorePurchases
} from '../utils/revenueCat'
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
// Inline feature glyphs — 20px stroke icons, currentColor so they
// inherit the row's text colour and look consistent in light/dark.
const FEATURE_ICONS = {
  discover: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="10" r="3" /><path d="M12 22s8-7.5 8-12a8 8 0 1 0-16 0c0 4.5 8 12 8 12z" />
    </svg>
  ),
  community: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  saves: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  ),
  collections: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  filters: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2.2" fill="currentColor" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2.2" fill="currentColor" />
      <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2.2" fill="currentColor" />
    </svg>
  ),
  radius: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    </svg>
  ),
  offline: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  adFree: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  poster: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" fill="currentColor" /><path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  badge: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="9" r="6" /><path d="M8.5 14L7 21l5-3 5 3-1.5-7" /><path d="M12 6l1.2 2.4 2.6.4-1.9 1.9.4 2.6L12 12.1l-2.3 1.2.4-2.6-1.9-1.9 2.6-.4z" fill="currentColor" stroke="none" />
    </svg>
  )
}

// a feature checkbox. Free column shows the ceiling; ROAM+ shows freedom.
const FEATURES = [
  { key: 'discover', label: 'Discover places near you', free: true, premium: true },
  { key: 'community', label: 'See what locals recommend', free: true, premium: true },
  { key: 'saves', label: 'Save places to revisit', free: '10', premium: 'Unlimited' },
  { key: 'collections', label: 'Build themed lists', free: '3', premium: 'Unlimited' },
  { key: 'filters', label: "Locals' picks & off-peak filters", free: false, premium: true },
  { key: 'radius', label: 'Reach further afield', free: 'Up to 30km', premium: 'Up to 150km' },
  { key: 'offline', label: 'Explore when signal drops', free: false, premium: 'Offline maps' },
  { key: 'adFree', label: 'Distraction-free browsing', free: false, premium: 'No ads, ever' },
  { key: 'poster', label: 'Print your visited map', free: false, premium: 'Poster export' },
  { key: 'badge', label: 'Scout badge on your profile', free: false, premium: true }
]

export default function Pricing() {
  const { user, checkAuth } = useAuth()
  const { isPremium, startCheckout, loading, error, subscriptionSource } = useSubscription()
  const [billingPeriod, setBillingPeriod] = useState('annual') // 'monthly' | 'annual'
  const [rcOffering, setRcOffering] = useState(null)
  const [rcLoading, setRcLoading] = useState(false)
  const [rcError, setRcError] = useState(null)
  const [restoring, setRestoring] = useState(false)

  // Fetch RC offerings on mount when on native. Web users skip this
  // entirely — they go through Stripe. Cross-source guard: if the user
  // already has a Stripe sub, we show the manage-on-web message
  // instead of letting them double-pay through Apple.
  const subscribedViaWeb = isPremium && subscriptionSource === 'stripe'

  useEffect(() => {
    if (!isNative() || subscribedViaWeb) return
    let cancelled = false
    rcGetOfferings().then((offering) => {
      if (!cancelled) setRcOffering(offering)
    })
    return () => { cancelled = true }
  }, [subscribedViaWeb])

  // Pick the package matching the user's selected billing period.
  // RC's standard identifiers are '$rc_monthly' and '$rc_annual' but
  // the offering API also exposes packageType, which is more reliable.
  const selectedPackage = rcOffering?.availablePackages?.find(p =>
    billingPeriod === 'annual'
      ? p.packageType === 'ANNUAL'
      : p.packageType === 'MONTHLY'
  ) || null

  const monthlyPrice = PRICING.monthly
  const annualPrice = PRICING.annual
  const annualMonthly = (annualPrice / 12).toFixed(2)
  const savingsPercent = Math.round((1 - annualPrice / (monthlyPrice * 12)) * 100)

  const openAuthModal = useCallback((mode = 'signup') => {
    window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode } }))
  }, [])

  const handleNativePurchase = useCallback(async () => {
    if (!user) {
      track('upgrade-clicked', { plan: billingPeriod, surface: 'pricing-page', authed: false })
      openAuthModal('signup')
      return
    }
    if (!selectedPackage) {
      setRcError('Subscription not available — please try again in a moment.')
      return
    }
    setRcLoading(true)
    setRcError(null)
    track('upgrade-clicked', { plan: billingPeriod, surface: 'pricing-page', authed: true, store: 'apple' })
    const result = await rcPurchasePackage(selectedPackage)
    setRcLoading(false)
    if (result.cancelled) return // silent — user backed out of the StoreKit sheet
    if (!result.success) {
      setRcError(result.error || 'Purchase failed')
      return
    }
    // Webhook will update the DB; re-poll /api/auth so the UI flips to
    // "Current Plan" without making the user manually refresh.
    track('upgrade-completed', { plan: billingPeriod, store: 'apple' })
    await checkAuth()
  }, [user, billingPeriod, selectedPackage, checkAuth, openAuthModal])

  const handleRestorePurchases = useCallback(async () => {
    setRestoring(true)
    setRcError(null)
    const result = await rcRestorePurchases()
    setRestoring(false)
    if (result.success) {
      // Re-poll auth so isPremium flips to true.
      await checkAuth()
    } else if (result.error) {
      setRcError(result.error)
    } else {
      // No error but no entitlement — most likely the user genuinely
      // hasn't purchased on this Apple ID. Don't show this as an error.
      setRcError('No previous purchases found on this Apple ID.')
    }
  }, [checkAuth])

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
                  <span className="pricing-feature-icon">{FEATURE_ICONS[feature.key]}</span>
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
                  <span className="pricing-feature-icon">{FEATURE_ICONS[feature.key]}</span>
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
              ) : isIosNative() && subscribedViaWeb ? (
                /* Cross-source guard — user already paid via Stripe on
                   web. Don't let them double-pay through Apple. */
                <button
                  className="pricing-btn primary"
                  onClick={() => openExternalUrl('https://www.go-roam.uk/account')}
                >
                  Manage subscription on web
                </button>
              ) : isIosNative() ? (
                /* Native iOS purchase via RevenueCat + StoreKit. */
                <button
                  className="pricing-btn primary"
                  onClick={handleNativePurchase}
                  disabled={rcLoading || !selectedPackage}
                >
                  {rcLoading ? 'Loading...' :
                    !selectedPackage ? 'Subscription unavailable' :
                    `Start 7-day free trial`}
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
              {error && error !== 'iap-not-available' && <p className="pricing-error">{error}</p>}
              {rcError && <p className="pricing-error">{rcError}</p>}
              {isIosNative() && !isPremium && !subscribedViaWeb && (
                <>
                  {/* Restore Purchases — App Store Review Guideline 3.1.1
                      requires this for any app with non-consumable IAP.
                      Lets a user who reinstalls, switches devices, or
                      signed in fresh recover their existing subscription. */}
                  <button
                    type="button"
                    className="pricing-restore-link"
                    onClick={handleRestorePurchases}
                    disabled={restoring}
                  >
                    {restoring ? 'Restoring…' : 'Restore Purchases'}
                  </button>
                </>
              )}
              {isIosNative() ? (
                <>
                  {/* Required disclosures on the purchase screen
                      (Apple's mandatory subscription terms language). */}
                  <p className="pricing-trial-note">
                    {selectedPackage ? (
                      <>7 days free, then {selectedPackage.product?.priceString || `£${billingPeriod === 'annual' ? annualPrice : monthlyPrice.toFixed(2)}`}{billingPeriod === 'annual' ? '/year' : '/month'}. Auto-renews; cancel anytime in Settings → Apple ID → Subscriptions. Payment will be charged to your Apple ID.</>
                    ) : (
                      <>Loading subscription details…</>
                    )}
                  </p>
                  <p className="pricing-legal-links">
                    {/* In-app navigation only on iOS native — opening an
                        external Safari for /terms or /privacy from the
                        purchase screen reads as "go pay outside the app"
                        even though these are just legal docs. Keep the
                        user inside the app. */}
                    <Link to="/terms">Terms of Use</Link>
                    {' · '}
                    <Link to="/privacy">Privacy Policy</Link>
                  </p>
                </>
              ) : (
                <>
                  <p className="pricing-trial-note">
                    7 days free, then £{billingPeriod === 'annual' ? annualPrice : monthlyPrice.toFixed(2)}{billingPeriod === 'annual' ? '/year' : '/month'}. Subscription auto-renews until canceled at least 24 hours before the end of the current period. Cancel anytime during the trial — no charge.
                  </p>
                  <p className="pricing-legal-links">
                    By subscribing you agree to our{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Use</a>
                    {' '}and{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
                  </p>
                </>
              )}
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
            <span>
              {isIosNative()
                ? 'Apple handles payments through your Apple ID — your card never touches our servers.'
                : 'Stripe handles payments — your card never touches our servers.'}
            </span>
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
              <p>
                {isIosNative()
                  ? 'Yes. Payments are processed by Apple through your Apple ID. We never see your card details.'
                  : 'Yes. All payments are handled by Stripe. We never see your card details.'}
              </p>
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
