# ROAM Feature Gaps Plan

> Addressing the remaining feature gaps before business features (Phase 6C)

**Created**: 2026-01-25
**Status**: Ready for implementation
**Priority**: Complete these before business features

---

## Overview

The security audit is complete (60 issues fixed). This document addresses the remaining feature gaps that affect end-user experience. Business features (owner verification, dashboard) are explicitly deferred.

---

## Gap 1: Place Page "Go" Button Does Nothing

**File**: `src/pages/Place.jsx:82-85`
**Severity**: Minor UX gap
**Effort**: Small (15 min)

### Current State
```javascript
const handleGo = (place) => {
  console.log('User navigating to:', place.name)
}
```

### Required Changes
1. Import `useVisitedPlaces` hook
2. Call `markVisited(place)` when user clicks "Go"
3. Optionally show the VisitedPrompt for rating/tip

### Implementation
```javascript
import { useVisitedPlaces } from '../hooks/useVisitedPlaces'

// In component:
const { markVisited } = useVisitedPlaces()

const handleGo = (place) => {
  markVisited(place)
  // Open in maps
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`
  window.open(mapsUrl, '_blank')
}
```

---

## Gap 2: Trending Places Not Integrated

**Files**:
- `src/components/TrendingPlaces.jsx` (exists, complete)
- `src/hooks/useTrendingPlaces.js` (exists, complete)
- `api/places/trending.js` (exists, complete)
- `src/pages/Discover.jsx` (needs integration)

**Severity**: Feature not visible
**Effort**: Small (30 min)

### Current State
- All code exists and works
- Component returns `null` if no trending data (graceful fallback)
- Not rendered anywhere in the app

### Required Changes
1. Import `TrendingPlaces` in Discover.jsx
2. Add to empty state or sidebar
3. Wire up `onSelectPlace` to load place detail

### Integration Options

**Option A: Show when cards exhausted**
```jsx
{cards.length === 0 && !loading && (
  <div className="discover-empty">
    <TrendingPlaces onSelectPlace={handleViewTrending} />
    {/* existing empty state */}
  </div>
)}
```

**Option B: Show in a collapsible sidebar**
```jsx
<aside className="discover-sidebar">
  <TrendingPlaces onSelectPlace={handleViewTrending} />
</aside>
```

### Handler Implementation
```javascript
const handleViewTrending = async (placeId) => {
  const place = await fetchPlaceById(placeId)
  if (place) {
    setSelectedPlace(place)
  }
}
```

---

## Gap 3: Offline Maps Not Exposed in UI

**Files**:
- `src/hooks/useOfflineMaps.js` (exists, complete)
- `src/components/OfflineMapsManager.jsx` (exists, complete)
- Settings page or Discover (needs integration)

**Severity**: Feature hidden
**Effort**: Medium (1-2 hours)

### Current State
- Hook fully implemented with:
  - `prefetchArea({ lat, lng, radiusKm })`
  - `clearCache()`
  - `estimateStorageUsed()`
  - Progress tracking during prefetch
- Service worker handles tile caching (already implemented)
- No UI exposes these features

### Required Changes

**Option A: Add to Settings page**
```jsx
// In Settings.jsx
import { useOfflineMaps } from '../hooks/useOfflineMaps'

const {
  isSupported,
  isPrefetching,
  prefetchProgress,
  prefetchArea,
  clearCache,
  estimateStorageUsed
} = useOfflineMaps()

// Render section for offline maps
<section className="settings-section">
  <h3>Offline Maps</h3>
  {!isSupported ? (
    <p>Not supported in this browser</p>
  ) : (
    <>
      <p>Cache maps for offline use</p>
      <button onClick={() => prefetchArea({ lat, lng, radiusKm: 5 })}>
        Download Current Area
      </button>
      {isPrefetching && <progress value={prefetchProgress} max="1" />}
      <button onClick={clearCache}>Clear Cache</button>
    </>
  )}
</section>
```

**Option B: Auto-prefetch on save**
When user saves a place, offer to cache the surrounding area for offline viewing.

### Dependencies
- Need user's current location (already available in Discover)
- Settings page needs to be created or extended

---

## Gap 4: Push Notifications Not Wired

**Files**:
- `src/hooks/usePushNotifications.js` (exists, complete)
- `api/push/vapid-public-key.js` (exists)
- `api/push/subscribe.js` (exists)
- `api/push/unsubscribe.js` (exists)
- `public/sw.js` (push handler exists)

**Severity**: Feature incomplete
**Effort**: Medium-Large (2-4 hours)

### Current State
- Frontend hook fully implemented
- API endpoints exist
- Service worker handles incoming push events
- **Missing**: VAPID keys, Settings UI, server-side send logic

### Required Changes

#### 4.1 Generate VAPID Keys
```bash
npx web-push generate-vapid-keys
```
Add to `.env`:
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:hello@go-roam.uk
```

#### 4.2 Settings UI for Notifications
```jsx
// In Settings.jsx or new NotificationSettings component
import { usePushNotifications } from '../hooks/usePushNotifications'

const { supported, isSubscribed, subscribe, unsubscribe, loading } = usePushNotifications()

<section className="settings-section">
  <h3>Notifications</h3>
  {!supported ? (
    <p>Push notifications not supported</p>
  ) : (
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={isSubscribed}
        onChange={() => isSubscribed ? unsubscribe() : subscribe()}
        disabled={loading}
      />
      <span>Enable push notifications</span>
    </label>
  )}
</section>
```

#### 4.3 Server-side Send Logic (New)
Create `api/push/send.js` for internal use:

```javascript
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

export async function sendPushToUser(userId, payload) {
  // Fetch user's subscription from DB
  const subscription = await query(
    'SELECT * FROM push_subscriptions WHERE user_id = ?',
    [userId]
  )

  if (!subscription) return

  await webpush.sendNotification(
    JSON.parse(subscription.subscription_json),
    JSON.stringify(payload)
  )
}
```

#### 4.4 Trigger Notifications
Add calls to `sendPushToUser` in:
- `api/social/index.js` - When someone follows you
- `api/contributions/index.js` - When your tip gets upvoted
- `api/social/requests.js` - When follow request approved

#### 4.5 Database Table
```sql
CREATE TABLE push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  subscription_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_endpoint (endpoint(255)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### Dependencies
- `web-push` npm package
- VAPID keys in environment
- Database table for subscriptions

---

## Gap 5: Photo Contributions Not Implemented

**Files**:
- `api/contributions/index.js` (needs photo support)
- Frontend contribution form (needs photo upload UI)
- Storage solution needed (Vercel Blob, S3, etc.)

**Severity**: Feature incomplete
**Effort**: Large (4-6 hours)

### Current State
- Contribution types mentioned in UI but photos have no backend
- No file upload endpoint
- No storage configured

### Required Changes

#### 5.1 Choose Storage Solution
**Recommended**: Vercel Blob (simple, integrated with Vercel hosting)

```bash
npm install @vercel/blob
```

#### 5.2 Create Upload Endpoint
`api/contributions/upload.js`:

```javascript
import { put } from '@vercel/blob'
import { requireAuth } from '../lib/auth.js'

export const config = {
  api: { bodyParser: false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const filename = `contributions/${user.id}/${Date.now()}.jpg`
    const blob = await put(filename, req, { access: 'public' })

    return res.status(200).json({ url: blob.url })
  } catch (error) {
    return res.status(500).json({ error: 'Upload failed' })
  }
}
```

#### 5.3 Update Contributions Schema
```sql
ALTER TABLE contributions ADD COLUMN photo_url VARCHAR(500) DEFAULT NULL;
```

#### 5.4 Update Contributions API
In `api/contributions/index.js`, accept `photoUrl` in POST:

```javascript
// In POST handler
const { content, type, photoUrl } = req.body

// Validate photoUrl if provided
if (photoUrl && !photoUrl.startsWith('https://')) {
  return res.status(400).json({ error: 'Invalid photo URL' })
}

// Include in INSERT
await query(
  `INSERT INTO contributions (place_id, user_id, content, type, photo_url)
   VALUES (?, ?, ?, ?, ?)`,
  [placeId, user.id, content, type || 'tip', photoUrl || null]
)
```

#### 5.5 Frontend Upload Component
Create `src/components/PhotoUpload.jsx`:

```jsx
export default function PhotoUpload({ onUpload, disabled }) {
  const [uploading, setUploading] = useState(false)

  const handleChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    try {
      const res = await fetch('/api/contributions/upload', {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': file.type,
          ...getAuthHeaders()
        }
      })
      const { url } = await res.json()
      onUpload(url)
    } finally {
      setUploading(false)
    }
  }

  return (
    <label className="photo-upload">
      <input type="file" accept="image/*" onChange={handleChange} disabled={disabled || uploading} />
      {uploading ? 'Uploading...' : 'Add Photo'}
    </label>
  )
}
```

### Dependencies
- `@vercel/blob` package
- Vercel Blob storage configured
- Database migration for photo_url column

---

## Implementation Order

| Priority | Gap | Effort | Dependencies |
|----------|-----|--------|--------------|
| 1 | Place.jsx handleGo | 15 min | None |
| 2 | Trending Places integration | 30 min | None |
| 3 | Offline Maps UI | 1-2 hours | Settings page |
| 4 | Push Notifications | 2-4 hours | VAPID keys, DB table, web-push |
| 5 | Photo Contributions | 4-6 hours | Vercel Blob, DB migration |

**Total estimated effort**: 8-13 hours

---

## Testing Checklist

### Gap 1: Place handleGo
- [ ] Click "Go" on Place page marks as visited
- [ ] Opens Google Maps with correct destination
- [ ] Visited count increases in profile

### Gap 2: Trending Places
- [ ] Trending section appears on Discover when data exists
- [ ] Clicking trending place opens detail modal
- [ ] Gracefully hidden when no trending data

### Gap 3: Offline Maps
- [ ] Download button works in Settings
- [ ] Progress bar shows during prefetch
- [ ] Maps work when offline (after prefetch)
- [ ] Clear cache removes tiles

### Gap 4: Push Notifications
- [ ] Toggle appears in Settings
- [ ] Permission prompt shows on enable
- [ ] Notification received when followed
- [ ] Notification received when tip upvoted
- [ ] Disable toggle unsubscribes

### Gap 5: Photo Contributions
- [ ] Photo picker appears in contribution form
- [ ] Upload shows progress
- [ ] Photo appears in contribution display
- [ ] Photos render in place detail tips

---

## Notes

- **Not included**: Business features (Phase 6C) - owner verification, business dashboard, "Owner says" responses
- **Not included**: Deep links (can be added later with minimal effort)
- **PWA already works**: Service worker, manifest, install prompt all functional
