# Push Notifications Setup

This guide explains how to enable push notifications in ROAM.

## Prerequisites

1. **Install web-push package**
   ```bash
   npm install web-push
   ```

2. **Generate VAPID keys**
   ```bash
   npx web-push generate-vapid-keys
   ```
   This will output something like:
   ```
   Public Key:
   BEL1234abcd...

   Private Key:
   xyz789...
   ```

3. **Add to environment variables**

   In Vercel dashboard (Settings > Environment Variables):
   ```
   VAPID_PUBLIC_KEY=BEL1234abcd...
   VAPID_PRIVATE_KEY=xyz789...
   VAPID_SUBJECT=mailto:hello@go-roam.uk
   ```

   For local development, add to `.env`:
   ```
   VAPID_PUBLIC_KEY=BEL1234abcd...
   VAPID_PRIVATE_KEY=xyz789...
   VAPID_SUBJECT=mailto:hello@go-roam.uk
   ```

## Database Table

Run this SQL to create the push subscriptions table:

```sql
CREATE TABLE push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh_key VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_endpoint (endpoint(255)),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## How It Works

1. **User enables notifications** in Settings tab
2. Browser requests notification permission
3. If granted, browser creates a push subscription
4. Subscription is saved to `push_subscriptions` table via `/api/push/subscribe`
5. When events happen (follow, upvote), server sends push via `web-push` library
6. Service worker receives push and displays notification

## Files

| File | Purpose |
|------|---------|
| `api/push/vapid-public-key.js` | Returns public key for browser |
| `api/push/subscribe.js` | Saves subscription to database |
| `api/push/unsubscribe.js` | Removes subscription |
| `api/lib/pushNotifications.js` | Server-side send utilities |
| `src/hooks/usePushNotifications.js` | Frontend subscription hook |
| `public/sw.js` | Service worker handles incoming pushes |

## Testing Locally

1. Run `npm run dev:full`
2. Go to Settings tab in your profile
3. Toggle "Push Notifications" on
4. Browser will request permission
5. Check browser console for subscription details

Note: Push notifications only work over HTTPS (or localhost).

## Integrating Into Events

To send notifications when things happen, import and use the helper functions:

```javascript
import { notifyNewFollower, notifyContributionUpvote } from '../lib/pushNotifications.js'

// When someone follows
await notifyNewFollower(followerId, followeeId, followerUsername)

// When a tip gets upvoted
await notifyContributionUpvote(authorId, placeName, voteCount)
```

The functions gracefully handle:
- Missing web-push package (logs warning, returns false)
- Missing VAPID keys (logs warning, returns false)
- Expired subscriptions (auto-deletes from database)
- Users with no subscriptions (returns false)

## Notification Types

| Event | Title | Body |
|-------|-------|------|
| New follower | "New Follower" | "@username started following you" |
| Tip upvoted | "Your tip is helpful!" | "Your tip about Place has N upvotes" |
| Follow approved | "Follow Request Accepted" | "@username accepted your follow request" |
