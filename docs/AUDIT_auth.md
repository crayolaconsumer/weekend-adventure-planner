# Auth Subsystem Audit

Date: 2026-05-19

## Scope

Reviewed email/password registration and login, Google OAuth on web/native, Apple Sign-In on web/native, JWT issuance and storage, request authorization, anonymous saved-place/rating migration, token expiry handling, logout, and the saved-place migration endpoint.

Primary files: `api/auth/index.js`, `api/auth/apple/callback.js`, `api/auth/apple-notifications.js`, `api/lib/auth.js`, `api/lib/cors.js`, `api/lib/rateLimit.js`, `api/places/saved/migrate.js`, `src/contexts/AuthContext.jsx`, `src/hooks/usePlaceRatings.js`, `src/components/AuthModal.jsx`, `src/utils/nativePlugins.js`, `src/pages/UnifiedProfile.jsx`, `src/pages/UnifiedProfile/SettingsTab.jsx`.

## Findings

### P1 - Saved-place migration was guarded by a browser-global flag

Status: fixed in `d703347`.

`src/contexts/AuthContext.jsx:50` previously used one `roam_places_migrated` flag for every account in the same browser. If user A had migrated once, then signed out, collected anonymous saves, and user B signed in, `migrateLocalData()` returned early and never called `api/places/saved/migrate.js`. That could silently lose anonymous saves during account upgrade on shared devices.

Fix: migration is now keyed by signed-in user id (`roam_places_migrated_<userId>`) and all login/register/social paths pass `data.user?.id` (`src/contexts/AuthContext.jsx:50`, `src/contexts/AuthContext.jsx:168`, `src/contexts/AuthContext.jsx:199`, `src/contexts/AuthContext.jsx:235`, `src/contexts/AuthContext.jsx:296`). The server migration endpoint remains idempotent via `ON DUPLICATE KEY` (`api/places/saved/migrate.js:62`).

### P1 - Expired/invalid JWTs stayed in client storage after auth rejection

Status: fixed in `d703347`.

`checkAuth()` sent the stored bearer token to `/api/auth`, but on `401` it only set `user` to null. The bad token stayed in `localStorage` or `sessionStorage`, so later hooks continued attaching a known-invalid `Authorization` header and could produce repeated silent failures instead of a clean signed-out state.

Fix: non-OK auth checks now call `clearStoredToken()` before clearing the user (`src/contexts/AuthContext.jsx:110`).

### P2 - Native Apple Sign-In has hard-coded production identifiers/redirect URL

Status: deferred.

`src/utils/nativePlugins.js:30` hard-codes `clientId: 'com.goroam.app'` and `redirectURI: 'https://www.go-roam.uk/api/auth/apple/callback'`. This matches the production native app, but it will break alternate bundle IDs, staging domains, or white-label/test builds unless the binary is edited. Server-side Apple auth already reads `APPLE_SIGNIN_SERVICES_ID` and `APPLE_BUNDLE_ID` from env (`api/auth/index.js:35`), so the client should eventually use Vite/native config for parity.

### P2 - OAuth popup flows do not bind a local state/nonce through to server verification

Status: deferred.

Google and Apple tokens are cryptographically verified server-side (`api/auth/index.js:334`, `api/auth/index.js:487`), and native Apple sends a nonce to the plugin (`src/utils/nativePlugins.js:26`). The current web Google token-client path and Apple JS popup path do not store a local state/nonce and validate it after the popup returns (`src/components/AuthModal.jsx:157`, `src/components/AuthModal.jsx:245`). Because the server does not consume authorization codes or redirect callbacks for these flows, this is not a direct callback-CSRF bug, but adding local correlation would reduce popup result injection risk.

## Verification

- `npm run lint` - passed
- `npm run build` - passed
- `npx vitest run` - failed on pre-existing unrelated suites: `Discover.stats`, `UnifiedProfile.badges`, `UnifiedProfile.utils`, `osmTagMapping`, and `Plan.constants`
- `git log @{u}..HEAD --oneline` confirmed local-only commits; no push performed
