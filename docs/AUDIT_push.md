# Push Notifications Audit

Date: 2026-05-19

## Scope

Reviewed web VAPID subscription, native iOS APNS registration, Android FCM path, backend subscription storage, server dispatch, notification tap routing, NotificationBell badge updates, token cleanup, service-worker behavior, and every `sendPushToUser()` / `notify*()` call site.

Primary files: `api/lib/pushNotifications.js`, `api/push/subscribe.js`, `api/push/unsubscribe.js`, `api/push/vapid-public-key.js`, `api/notifications/index.js`, `src/hooks/usePushNotifications.js`, `src/hooks/useNotifications.js`, `src/components/NotificationBell.jsx`, `src/App.jsx`, `public/sw.js`, `index.html`, `capacitor.config.json`, `api/social/index.js`, `api/social/requests.js`, `api/contributions/index.js`, `api/cron/visit-reminders.js`, `api/cron/re-engagement-nudge.js`.

## Findings

### P1 - Web badge-update pushes lost their silent payload

Status: fixed in `13c56dc`.

`pushNotificationBadge()` sent `{ data: { type: 'BADGE_UPDATE', unreadCount, silent: true } }` (`api/lib/pushNotifications.js:408`), and the service worker correctly suppresses visible notifications when it sees that type (`public/sw.js:589`). But `dispatchVapid()` replaced all payload data with only `{ url }`, so the service worker could not detect badge updates and would treat them as normal pushes.

Fix: VAPID payload data now merges `payload.data` and preserves `url` (`api/lib/pushNotifications.js:183`).

### P1 - Push unsubscribe could delete any known endpoint

Status: fixed in `13c56dc`.

`api/push/unsubscribe.js` previously deleted solely by `endpoint`. An unauthenticated caller who knew or guessed an endpoint could remove another user's push token. Current clients send auth headers from `usePushNotifications()` (`src/hooks/usePushNotifications.js:246`), so the server can safely scope deletion.

Fix: authenticated callers now delete only rows matching both endpoint and `user_id`; unauthenticated callers can only delete anonymous rows (`api/push/unsubscribe.js:30`).

### P2 - Logout does not unregister this device's push token

Status: deferred.

`logout()` clears auth state (`src/contexts/AuthContext.jsx:334`) but does not call `unsubscribe()` or otherwise detach the current device token. If a user logs out and never signs another user in, their server-side push row can still receive notifications for that account. When another user signs in on the same device, `PushAuthSync` re-registers/upserts the token to the new user (`src/App.jsx:115`, `src/hooks/usePushNotifications.js:122`), which limits but does not eliminate the logout gap. A clean fix needs current-device endpoint lookup for both web and native before auth is cleared.

### P2 - Push permission is auto-requested immediately after sign-in

Status: deferred.

`PushAuthSync` calls `subscribe()` after authentication (`src/App.jsx:120`). If permission is still `default`, `subscribe()` opens the OS/browser permission prompt (`src/hooks/usePushNotifications.js:121`, `src/hooks/usePushNotifications.js:169`). This is intentional per current comments, but it conflicts with a conservative "do not nag" notification posture. Consider gating the first prompt behind a user action while keeping granted-token re-registration automatic.

### P2 - `notifyPlanShared()` exists but has no live call site

Status: deferred.

Most notify helpers are wired: follower (`api/social/index.js:592`), follow-request approval (`api/social/requests.js:185`), contribution upvote/removal (`api/contributions/index.js:563`, `api/contributions/index.js:580`), visit reminders (`api/cron/visit-reminders.js:40`), re-engagement (`api/cron/re-engagement-nudge.js:105`), and badge updates (`api/notifications/index.js:201`). `notifyPlanShared()` is exported (`api/lib/pushNotifications.js:513`) but no endpoint currently calls it. If plan sharing is expected to notify recipients, wire it where shares are created; otherwise remove or mark it as future.

## Notes

- NotificationBell is mounted globally in `src/App.jsx:521`, not orphaned.
- Native tap routing is wired through `PushTapHandler` (`src/App.jsx:63`); web tap routing is handled by `public/sw.js:630`.
- Service worker registration is disabled in Capacitor (`index.html:86`).
- Android FCM is still effectively deferred until Firebase service account env is configured; the dispatcher and documentation are present (`api/lib/pushNotifications.js:249`).

## Verification

- `npm run lint` - passed
- `npm run build` - passed
- `npx vitest run` - failed on the same pre-existing unrelated suites: `Discover.stats`, `UnifiedProfile.badges`, `UnifiedProfile.utils`, `osmTagMapping`, and `Plan.constants`
- `git log @{u}..HEAD --oneline` confirmed local-only commits; no push performed
