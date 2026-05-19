# Payments / RevenueCat Audit

Date: 2026-05-19

## Scope

Reviewed native iOS/Android RevenueCat purchase and restore flows, web Stripe Checkout, Stripe portal management, Stripe and RevenueCat webhooks, premium gating through `useSubscription()`, server-side free-tier limits, subscription expiry/cancellation state, and cross-source Apple/Google/Stripe guards.

Primary files: `src/hooks/useSubscription.js`, `src/utils/revenueCat.js`, `src/pages/Pricing.jsx`, `src/pages/UnifiedProfile/SettingsTab.jsx`, `src/components/UpgradePrompt.jsx`, `src/components/PremiumNudge.jsx`, `api/payments/create-checkout.js`, `api/payments/create-portal.js`, `api/payments/webhook.js`, `api/payments/revenuecat-webhook.js`, `api/lib/auth.js`, `api/lib/premium.ts`.

## Findings

### P1 - Stripe renewal fallback did not refresh expiry/source metadata

Status: fixed in `0e15caa`.

`invoice.paid` previously only ran `UPDATE users SET tier = 'premium'` (`api/payments/webhook.js:342`). If `customer.subscription.updated` was delayed, dropped, or processed out of order, the app could keep an old `subscription_expires_at`; `useSubscription()` and server helpers would still treat the user as non-premium once that old date passed.

Fix: `handleInvoicePaid()` now retrieves the Stripe subscription, requires `active` or `trialing`, and refreshes `subscription_id`, `subscription_expires_at`, `subscription_cancelled_at`, and `subscription_source` in the same premium update (`api/payments/webhook.js:359`).

### P2 - Stripe Checkout/Portal no-Origin fallback used the old `.com` domain

Status: fixed in `0e15caa`.

Both Stripe session creators fell back to `https://go-roam.com` when `Origin` was absent (`api/payments/create-checkout.js:142`, `api/payments/create-portal.js:104`). That could send users back to the wrong domain from Stripe in server-to-server, test, or unusual client contexts.

Fix: both now prefer `APP_URL`, then existing `NEXT_PUBLIC_APP_URL`, then `https://www.go-roam.uk`.

### P2 - RevenueCat granting events can overwrite a fresher expiry with an older event

Status: deferred.

`api/payments/revenuecat-webhook.js:117` comments that values should not be clobbered by out-of-order events, but the SQL unconditionally sets `subscription_expires_at = ?` (`api/payments/revenuecat-webhook.js:122`). A delayed older `RENEWAL`/`PRODUCT_CHANGE` could move expiry backwards. This needs a careful design decision because null expiry is currently treated as lifetime/comped premium by `useSubscription()` and `api/lib/premium.ts`.

### P2 - RevenueCat anonymous purchase events are acknowledged and dropped

Status: deferred.

The webhook ignores `$RCAnonymousID...` events (`api/payments/revenuecat-webhook.js:80`) on the assumption RevenueCat re-emits after `Purchases.logIn()` (`src/utils/revenueCat.js:88`). This is probably acceptable with the restore flow (`src/pages/Pricing.jsx:222`), but it is still a blast-radius dependency: if identification or transfer behavior does not occur, the user can pay natively without the server account flipping premium.

## Notes

- Stripe signature verification is present and uses raw body parsing (`api/payments/webhook.js:30`, `api/payments/webhook.js:64`).
- Server-side premium limits exist for saved places, collections, and saved events (`api/places/saved.js:146`, `api/collections/index.js:128`, `api/events/saved.js:168`).
- Cross-source revocation guards exist for delayed Stripe deletion (`api/payments/webhook.js:273`) and RevenueCat revocation (`api/payments/revenuecat-webhook.js:154`).

## Verification

- `npm run lint` - passed
- `npm run build` - passed
- `npx vitest run` - failed on the same pre-existing unrelated suites: `Discover.stats`, `UnifiedProfile.badges`, `UnifiedProfile.utils`, `osmTagMapping`, and `Plan.constants`
- `git log @{u}..HEAD --oneline` confirmed local-only commits; no push performed
