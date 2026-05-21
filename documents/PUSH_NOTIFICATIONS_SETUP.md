# Push Notifications Setup

ROAM supports three push paths:

| Platform | Transport | Stored token format |
| --- | --- | --- |
| Web/PWA | VAPID via `web-push` | Browser push endpoint URL plus `p256dh` and `auth` URL-safe base64 keys |
| iOS native | APNS token auth via `apns2` | 64-character hex APNS device token |
| Android native | Firebase Cloud Messaging v1 | FCM registration token, usually 64-500 chars |

Subscriptions live in `push_subscriptions`. Web rows use `endpoint`, `p256dh_key`, and `auth_key`; native rows store the device token in `endpoint` and leave the web key columns null.

## Environment Variables

Required production credentials:

| Variable | Validation rule |
| --- | --- |
| `VAPID_PUBLIC_KEY` | exactly 87 chars URL-safe base64 |
| `VAPID_PRIVATE_KEY` | exactly 43 chars URL-safe base64 |
| `VAPID_SUBJECT` | starts with `mailto:` or `https://` |
| `APNS_KEY_ID` | exactly 10 alphanumeric chars |
| `APNS_TEAM_ID` | exactly 10 alphanumeric chars |
| `APNS_BUNDLE_ID` | reverse-DNS bundle id, for example `com.goroam.app` |
| `APNS_AUTH_KEY` | PEM containing `-----BEGIN PRIVATE KEY-----` and ending with `-----END PRIVATE KEY-----` |
| `FCM_SERVICE_ACCOUNT_JSON_B64` or `FCM_SERVICE_ACCOUNT_JSON` | parses as JSON with `client_email`, `private_key`, and `project_id` |

`api/lib/pushNotifications.js` trims leading/trailing whitespace from these env vars at module load and uses the trimmed values for dispatch. If validation fails, startup logs the failing platform and dispatch returns a clear error for diagnostics instead of silently failing.

## Vercel Upload Gotcha

Never upload secrets with `echo`; it appends a newline and can corrupt VAPID/APNS/FCM values.

Use `printf`:

```bash
printf '%s' "value" | vercel env add NAME production
```

For FCM, prefer base64:

```bash
base64 < service-account.json | tr -d '\n' | vercel env add FCM_SERVICE_ACCOUNT_JSON_B64 production
```

If replacing a value:

```bash
vercel env rm NAME production
printf '%s' "value" | vercel env add NAME production
```

## Diagnostics Endpoint

`/api/diagnostics/push` is JWT-gated with the normal ROAM auth token (`Authorization: Bearer <token>` or the `roam_token` cookie).

`GET /api/diagnostics/push` returns:

```json
{
  "validation": { "vapid": "ok", "apns": "ok", "fcm": "ok" },
  "validationErrors": { "vapid": [], "apns": [], "fcm": [] },
  "subscriptions": {
    "userId": 12,
    "platforms": [
      { "platform": "ios", "endpoint_prefix": "abc...", "created_at": "2026-05-21T10:00:00.000Z" }
    ]
  },
  "lastTest": null
}
```

`POST /api/diagnostics/push` with `{ "test": true }` sends a real push to the requester's own subscriptions and returns per-subscription delivery status:

```bash
curl -X POST https://go-roam.uk/api/diagnostics/push \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"test":true}'
```

The Settings notifications panel shows permission state and subscription count for signed-in users. The "Send test notification" button is visible only for admins or when the page URL includes `?diagnostics=1`.

## Local Testing

1. Run `npm run dev:full`.
2. Sign in.
3. Open profile settings.
4. Enable "Push Notifications".
5. Open `/profile?tab=settings&diagnostics=1` and send a test notification.

Push requires HTTPS except on localhost. Native iOS/Android testing requires a real installed Capacitor build and valid APNS/FCM credentials.
