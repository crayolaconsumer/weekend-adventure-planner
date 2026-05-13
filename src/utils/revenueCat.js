/**
 * RevenueCat — native IAP wrapper for iOS + Android.
 *
 * Web users still go through Stripe (api/payments/create-checkout).
 * Native users go through RC, which wraps Apple StoreKit + Google Play
 * Billing under one API. RC's webhook updates the server's tier column
 * so the rest of the app (useSubscription, isPremium gates) doesn't
 * care which platform paid.
 *
 * App Store requires:
 *   - Restore Purchases button (handled in Pricing.jsx)
 *   - Terms of Service + Privacy Policy links on the purchase screen
 *   - Honest subscription disclosures (auto-renew, price, period)
 *
 * Cross-platform conflict guard: if a user has an active Stripe sub
 * (subscription_source === 'stripe' on the server), we hide the
 * native purchase buttons and tell them to manage at go-roam.uk —
 * stops them double-paying on iOS.
 */

import { isNative, getPlatform } from './nativeBridge'

const ENTITLEMENT_ID = import.meta.env.VITE_REVENUECAT_ENTITLEMENT_ID || 'premium'

let initialized = false
let initPromise = null

/**
 * Initialize RevenueCat. Idempotent — safe to call repeatedly.
 * Returns true if initialized successfully, false otherwise (web,
 * missing API key, etc.). Subsequent calls return cached result.
 */
export async function initRevenueCat() {
  if (initialized) return true
  if (initPromise) return initPromise

  initPromise = (async () => {
    if (!isNative()) return false

    const platform = getPlatform()
    const apiKey = platform === 'ios'
      ? import.meta.env.VITE_REVENUECAT_IOS_KEY
      : platform === 'android'
        ? import.meta.env.VITE_REVENUECAT_ANDROID_KEY
        : null

    if (!apiKey) {
      console.warn(`[RevenueCat] No API key configured for platform: ${platform}`)
      return false
    }

    // RC's native SDK refuses to initialize in production-signed builds
    // (TestFlight + App Store) when the key has the `test_` prefix —
    // and instead of just refusing, it calls exit() with a dialog
    // explaining the test key. That crashes the app on every launch.
    // Detect the prefix here and skip init entirely so the rest of the
    // app continues to work. IAP stays dormant until a production
    // `appl_` key is set in Vercel env.
    if (typeof apiKey === 'string' && apiKey.startsWith('test_')) {
      console.warn('[RevenueCat] Test key detected — skipping init to avoid SDK exit() in production build.')
      return false
    }

    try {
      const { Purchases, LOG_LEVEL } = await import('@revenuecat/purchases-capacitor')
      // Verbose only in dev — production logs would noise up the Xcode console.
      await Purchases.setLogLevel({
        level: import.meta.env.DEV ? LOG_LEVEL.VERBOSE : LOG_LEVEL.ERROR
      })
      await Purchases.configure({ apiKey })
      initialized = true
      return true
    } catch (err) {
      console.error('[RevenueCat] Init failed:', err)
      return false
    }
  })()

  return initPromise
}

/**
 * Identify the user to RevenueCat. Call after sign-in so purchases
 * attach to our user ID instead of an anonymous RC user. Without
 * this, a user who buys on one device then signs into another won't
 * see their subscription on the second device.
 */
export async function identifyUserToRC(userId) {
  if (!await initRevenueCat()) return
  if (!userId) return
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor')
    await Purchases.logIn({ appUserID: String(userId) })
  } catch (err) {
    console.error('[RevenueCat] logIn failed:', err)
  }
}

/**
 * Forget the current user on RC. Call on sign-out so the next user
 * signing in on the same device gets a clean slate.
 */
export async function logoutFromRC() {
  if (!initialized) return
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor')
    await Purchases.logOut()
  } catch (err) {
    // logOut() throws if user is already anonymous — harmless, ignore.
    if (!/already.*anonymous/i.test(err?.message || '')) {
      console.warn('[RevenueCat] logOut failed:', err)
    }
  }
}

/**
 * Fetch the configured offerings (subscription packages). Returns
 * the `current` offering with its packages, or null if RC isn't
 * available / no offering is configured.
 *
 * Each package has:
 *   - identifier: '$rc_monthly' | '$rc_annual' | etc.
 *   - product: { priceString, title, description, identifier, ... }
 *   - packageType: 'MONTHLY' | 'ANNUAL' | 'CUSTOM' | ...
 */
export async function getOfferings() {
  if (!await initRevenueCat()) return null
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor')
    const { current } = await Purchases.getOfferings()
    return current || null
  } catch (err) {
    console.error('[RevenueCat] getOfferings failed:', err)
    return null
  }
}

/**
 * Trigger purchase of a package. On iOS, this shows the system
 * StoreKit purchase sheet. Returns { success, customerInfo, cancelled }.
 *
 * @param {Object} pkg - Package from getOfferings().availablePackages
 */
export async function purchasePackage(pkg) {
  if (!await initRevenueCat()) {
    return { success: false, error: 'RevenueCat not available' }
  }
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor')
    const result = await Purchases.purchasePackage({ aPackage: pkg })
    const hasEntitlement = Boolean(result.customerInfo?.entitlements?.active?.[ENTITLEMENT_ID])
    return {
      success: hasEntitlement,
      customerInfo: result.customerInfo,
      cancelled: false
    }
  } catch (err) {
    // RC throws { userCancelled: true } on user cancellation — surface
    // that explicitly so the caller can swallow it silently (no error toast).
    if (err?.userCancelled || /user.*cancel/i.test(err?.message || '')) {
      return { success: false, cancelled: true }
    }
    return { success: false, error: err?.message || 'Purchase failed' }
  }
}

/**
 * Restore previous purchases. Apple Store Review Guideline 3.1.1
 * requires every app with non-consumable IAP to provide this.
 * Surfaces an existing subscription on a new device or after a
 * reinstall — without it, a user who reinstalls sees no premium
 * and has no way to recover it from the device.
 */
export async function restorePurchases() {
  if (!await initRevenueCat()) {
    return { success: false, error: 'RevenueCat not available' }
  }
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor')
    const { customerInfo } = await Purchases.restorePurchases()
    const hasEntitlement = Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID])
    return { success: hasEntitlement, customerInfo }
  } catch (err) {
    return { success: false, error: err?.message || 'Restore failed' }
  }
}

/**
 * Read current customer info — useful on app foreground to detect
 * a subscription that expired while the app was backgrounded.
 */
export async function getCustomerInfo() {
  if (!await initRevenueCat()) return null
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor')
    const { customerInfo } = await Purchases.getCustomerInfo()
    return customerInfo || null
  } catch (err) {
    console.error('[RevenueCat] getCustomerInfo failed:', err)
    return null
  }
}

/**
 * True if the current customer has the premium entitlement active.
 * Pure helper — caller is responsible for refreshing customerInfo
 * if they need a fresh read.
 */
export function hasActiveEntitlement(customerInfo) {
  return Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID])
}

/**
 * Check whether the current Apple ID / Play account is eligible for
 * the intro offer (free trial) on a given product.
 *
 * Apple enforces one trial per Apple ID per *subscription group* — if
 * the user previously subscribed to ANY product in our group, they're
 * ineligible for the trial on every other product. Showing them
 * "Start 7-day free trial" in that case is dishonest: StoreKit will
 * charge them at full price immediately.
 *
 * Returns one of: 'eligible' | 'ineligible' | 'no_intro' | 'unknown'.
 * Caller should default to NOT promising a trial unless 'eligible'.
 *
 * RC's status codes: 0=unknown, 1=ineligible, 2=eligible, 3=no_intro.
 */
export async function checkTrialEligibility(productId) {
  if (!productId) return 'unknown'
  if (!await initRevenueCat()) return 'unknown'
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor')
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility({
      productIdentifiers: [productId]
    })
    const entry = result?.[productId]
    const status = entry?.status
    switch (status) {
      case 2: return 'eligible'
      case 1: return 'ineligible'
      case 3: return 'no_intro'
      default: return 'unknown'
    }
  } catch (err) {
    console.warn('[RevenueCat] checkTrialEligibility failed:', err)
    return 'unknown'
  }
}

export { ENTITLEMENT_ID }
