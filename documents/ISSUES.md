# ROAM Critical Issues - Investigation & Fix Plan

> This document tracks all known issues, their root causes, and fix status. One thing to bear in mind, you can always at any time launch explore agents to better understand things if you feel you lack context. the more you know about the issue you're facing the better quality your response to it.  
> Last updated: 2026-01-24

---

## Quick Reference

| # | Issue | Priority | Status | Complexity |
|---|-------|----------|--------|------------|
| 1 | Driving mode no results | P0 | FIXED | Medium |
| 2 | App slow on mobile | P0 | FIXED | High |
| 3 | Page switching slow | P0 | FIXED | High |
| 4 | Settings page placeholder | P1 | FIXED | Medium |
| 5 | Duplicate settings buttons | P2 | FIXED | Low |
| 6 | No PWA install prompt | P1 | FIXED | Medium |
| 7 | No home screen logo | P1 | FIXED | Low |
| 8 | No user search | P2 | FIXED | High |
| 9 | No follow functionality | P2 | FIXED | High |
| 10 | No follow notifications | P2 | FIXED | High |
| 11 | Social hollow | P2 | FIXED | High |
| 12 | Location rarely used | P3 | WONTFIX | Low |
| 13 | Milestones fire randomly | P2 | FIXED | Medium |
| 14 | No milestone notifications | P2 | FIXED | Medium |
| 15 | Maps back = blank tab | P1 | FIXED | Low |
| 16 | Duplicate emoji category | P3 | FIXED | Low |
| 17 | Card stack iPhone SE | P2 | FIXED | Low |
| 18 | Duplicate events | P1 | FIXED | Medium |
| 19 | Events no load more | P1 | FIXED | Medium |
| 20 | Profile counters misaligned | P3 | FIXED | Low |
| 21 | Streak count missing | P2 | FIXED | Low |
| 22 | Subscription not found | P0 | FIXED | Medium |
| 23 | Saved events errors | P1 | FIXED | Medium |
| 24 | Lists need pagination | P1 | FIXED | High |
| 25 | Premium filters broken | P1 | FIXED | Medium |
| 26 | No itinerary indicator | P1 | FIXED | Low |
| 27 | Itinerary fails/slow | P0 | FIXED | Medium |
| 28 | Saved places not in itinerary | P1 | FIXED | Medium |
| 29 | No add saved to collection | P2 | FIXED | Medium |
| 30 | No notification system | P2 | FIXED | High |
| 31 | No SEO | P3 | FIXED | High |

---

## Detailed Research

### Issue 1: Driving Mode Returns No Results
**Priority:** P0 - App Breaking
**Status:** RESEARCHED

**Files:**
- `src/pages/Discover.jsx:30` - TRAVEL_MODES.driving.maxRadius = 30000
- `src/utils/apiClient.js:43-77` - buildOverpassQuery function

**Root Cause:**
Line 46-49 in apiClient.js:
```javascript
const isLargeRadius = radius > 15000
const nameFilter = isLargeRadius ? '["name"]' : ''
```
When driving mode (30km) is used, nameFilter requires ALL places to have an OSM `name` tag. This drastically reduces results in rural/suburban areas.

**Fix Required:**
1. Increase threshold for nameFilter OR
2. Make nameFilter less restrictive for 15-30km range OR
3. Add fallback sources when Overpass returns few results

---

### Issue 2-3: App Slow / Page Switching Slow
**Priority:** P0 - Critical UX
**Status:** RESEARCHED

**Files:**
- `src/pages/Discover.jsx:308-372` - loadPlaces function
- `src/pages/Discover.jsx:463-472` - filter reapplication
- `src/pages/Discover.jsx:166-255` - applyFilters without early returns
- `src/utils/apiClient.js` - API calls

**Root Causes:**
1. Every filter change triggers `applyFilters` which re-processes entire dataset
2. `fetchPlacesWithSWR` may not properly use cached data
3. No request deduplication causing duplicate API calls
4. Premium filters (lines 166-255) have nested filter operations without optimization
5. No pagination - appends all new places and refilters entire list

**Fix Required:**
1. Memoize `applyFilters` properly
2. Add request deduplication
3. Implement true pagination (not just "load more")
4. Add early returns in filter logic
5. Consider Web Worker for heavy filtering

---

### Issue 4: Settings Page is Placeholder
**Priority:** P1
**Status:** RESEARCHED

**Files:**
- `src/pages/UnifiedProfile.jsx:566-661` - SettingsTab component

**Root Cause:**
SettingsTab exists (line 566) but settings are READ-ONLY. Lines 619-652 just display values:
```javascript
<span className="unified-profile-settings-value">{user?.email || 'Not set'}</span>
```
No input fields, no save functionality.

**Fix Required:**
1. Replace static spans with input fields
2. Add save/update functionality
3. Connect to backend API for profile updates
4. Add validation and error handling

---

### Issue 5: Duplicate Settings Buttons
**Priority:** P2
**Status:** FIXED

**Files:**
- `src/pages/UnifiedProfile.jsx:189-196` - Header settings button (removed)
- `src/pages/UnifiedProfile.jsx:298-308` - Tab settings button (kept)
- `src/pages/UnifiedProfile.css` - Removed unused settings button CSS

**Root Cause:**
Two settings entry points existed:
1. Header gear icon button
2. Settings tab in tab bar
Both served the same purpose, creating UI redundancy.

**Fix Applied:**
1. Removed header settings button - the tab bar provides consistent navigation
2. Added header spacer to maintain balanced layout (same width as back button)
3. Removed now-unused `.unified-profile-settings-btn` CSS

---

### Issue 6: No PWA Install Prompt
**Priority:** P1
**Status:** RESEARCHED

**Files:**
- `public/manifest.json` - PWA manifest (correctly configured)
- Need to check: `src/main.jsx` or App.jsx for install prompt handler

**Root Cause:**
Manifest is correct, but no `beforeinstallprompt` event listener implemented to capture and show the install prompt to users.

**Fix Required:**
1. Add `beforeinstallprompt` listener in App.jsx
2. Save prompt event to state
3. Create "Install App" UI component
4. Trigger prompt.prompt() on user action

---

### Issue 7: No Home Screen Logo
**Priority:** P1
**Status:** RESEARCHED

**Files:**
- `public/manifest.json:13-26` - Icons array
- `public/icons/` - Only contains icon.svg

**Root Cause:**
Manifest only references SVG icons:
```json
"icons": [
  { "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml" }
]
```
SVG icons don't work on iOS home screen. Need PNG icons.

**Fix Required:**
1. Create PNG icons: 192x192, 512x512, 180x180 (iOS)
2. Update manifest.json with PNG icon entries
3. Add apple-touch-icon link in index.html

---

### Issue 8: User Search
**Priority:** P2
**Status:** FIXED

**Files:**
- `api/users/search.js` - Created
- `src/hooks/useSocial.js` - Added useUserSearch hook
- `src/pages/Activity.jsx` - Added search UI
- `src/pages/Activity.css` - Added search styling

**Fix Applied:**
1. Created `api/users/search.js` endpoint that searches by username or display_name
2. Added `useUserSearch` hook with debounced search and pagination
3. Added search bar to Activity page with real-time search results
4. Shows search results count, loading states, and "no results" message
5. Clear button to dismiss search and return to Feed/Discover tabs

---

### Issue 9: Follow Functionality
**Priority:** P2
**Status:** FIXED (Already Working)

**Files:**
- `src/components/FollowButton.jsx` - Full implementation exists
- `src/hooks/useSocial.js` - useFollow hook implemented
- `api/social/index.js` - Follow/unfollow endpoints work
- `src/pages/UnifiedProfile.jsx` - FollowButton integrated

**Root Cause:**
The infrastructure was already complete. FollowButton component uses useFollow hook which calls the social API. The button is integrated into UnifiedProfile for viewing other users' profiles.

**No Fix Required** - Feature was working, just needed verification.

---

### Issue 10: Follow Notifications
**Priority:** P2
**Status:** FIXED

**Files:**
- `api/notifications/index.js` - Created notifications API
- `api/social/index.js` - Updated to create notification on follow
- `src/hooks/useNotifications.js` - Created notification hook
- `src/components/NotificationBell.jsx` - Created notification bell UI
- `src/components/NotificationBell.css` - Notification styling
- `src/pages/Activity.jsx` - Added NotificationBell to header

**Fix Applied:**
1. Created notifications API with GET (fetch), POST (mark read) actions
2. Added `createNotification` helper function exported for other APIs
3. Updated follow endpoint to create notification when someone follows you
4. Created useNotifications hook with polling for new notifications
5. Created NotificationBell component with dropdown panel
6. Shows unread count badge, notification items with avatars
7. Auto-marks notifications as read after 2 seconds of viewing
8. "Mark all read" button for bulk clearing
9. Added to Activity page header for authenticated users

---

### Issue 11: Activity Feed
**Priority:** P2
**Status:** FIXED (Already Working)

**Files:**
- `src/components/ActivityFeed.jsx` - Full implementation
- `src/pages/Activity.jsx` - Activity page with Feed/Discover tabs
- `api/social/index.js` - Feed endpoint returns followed users' contributions

**Root Cause:**
The infrastructure was already complete:
- ActivityFeed component shows contributions from followed users
- Activity page accessible from navigation
- useActivityFeed hook fetches from /api/social?action=feed

**No Fix Required** - Feature was working, just needed verification.

---

### Issue 12: Location Rarely Used
**Priority:** P3
**Status:** WONTFIX (Product Decision)

**Description:**
The app requests location permission but could make better use of location data throughout the experience.

**Current Usage:**
- Location is used in Discover page to find nearby places
- Location is used for distance calculations in place cards
- Location fallback to London when permission denied

**Potential Enhancements (Product Decisions):**
1. Weather-based recommendations using location
2. Location-aware event suggestions
3. "Near me" filters in Wishlist
4. Location-based notifications ("You're near a saved place!")
5. Auto-updating location during active exploration

**Reason for WONTFIX:**
This is not a bug but a product roadmap item. The current location usage is appropriate for the app's core functionality. Additional location features should be evaluated based on:
- User privacy concerns
- Battery impact
- Actual user value

These enhancements require product decisions about scope, privacy, and UX design before implementation.

---

### Issue 13-14: Milestones Fire Randomly / No Notifications
**Priority:** P2
**Status:** FIXED

**Files:**
- `src/pages/UnifiedProfile.jsx` - Badge notification system

**Root Cause:**
1. No tracking of which badges were previously earned
2. No notification when new badges unlocked
3. Stats were correct, but user had no visibility

**Fix Applied:**
1. Added `roam_earned_badges` localStorage key to track earned badge IDs
2. On profile load, compare current earned badges vs stored
3. For each newly earned badge, show toast notification with badge icon and name
4. Stagger multiple badge toasts (1 second apart) to prevent overlap
5. Auto-sync stored badges when badge list changes
6. Uses existing toast system (`toast.success()`)
7. Only checks once per session using ref flag

---

### Issue 15: Maps Back Button = Blank Tab
**Priority:** P1
**Status:** RESEARCHED

**Files:**
- `src/pages/Discover.jsx:921` - window.open for directions
- `src/components/PlaceDetail.jsx:185` - window.open
- `src/components/CardStack.jsx:159` - window.open

**Root Cause:**
All use:
```javascript
window.open(url, '_blank', 'noopener,noreferrer')
```
The `noopener` prevents proper navigation back. On mobile, closing Maps app returns to blank tab.

**Fix Required:**
1. Use `window.location.href = url` for same-tab navigation OR
2. Use `<a href={url} target="_blank">` without noopener OR
3. Implement native deep linking for iOS/Android maps apps

---

### Issue 16: Duplicate Emoji in Category View
**Priority:** P3
**Status:** FIXED

**Files:**
- `src/components/DiscoverList.jsx:71-80` - Thumbnail placeholder

**Root Cause:**
In DiscoverList, when a place had no photo:
1. Line 77: Category icon shown in thumbnail placeholder
2. Line 87: Category icon shown again in category badge
Same emoji appeared twice on the same card.

**Fix Applied:**
Changed thumbnail placeholder to always use a generic pin icon (📍) instead of the category icon. The category badge (icon + label) still shows the specific icon, avoiding duplication.

---

### Issue 17: Card Stack iPhone SE Spacing
**Priority:** P2
**Status:** FIXED

**Files:**
- `src/components/CardStack.css:369-385` - Media query for small screens

**Root Cause:**
Media query at 380px triggered on iPhone SE (375px) with insufficient top padding, causing cards to appear too close to header buttons.

**Fix Applied:**
1. Changed media query from 380px to 375px to precisely target iPhone SE
2. Added `padding-top: var(--space-xl)` for more top spacing
3. Reduced card wrapper max-width to 340px for better proportions
4. Added comment for clarity

---

### Issue 18: Duplicate Events in Stack
**Priority:** P1
**Status:** FIXED

**Files:**
- `src/utils/eventsApi.js:79-108` - deduplicateEvents function

**Root Cause:**
Deduplication logic flaw:
- Uses seenByPrimary and seenByFuzzy Maps
- When fuzzy match found but not primary, adds to seenByPrimary but fuzzy map not updated
- Same event with slightly different names gets added twice

**Fix Applied:**
1. Changed seenByFuzzy to store primaryKey instead of event object (reverse lookup)
2. When replacing via fuzzy match, now properly deletes old primary key entry
3. Ensures no duplicates remain in final seenByPrimary values

---

### Issue 19: Events No Load More
**Priority:** P1
**Status:** FIXED

**Files:**
- `src/pages/Events.jsx` - No load more implementation

**Root Cause:**
Events fetched once with no pagination. When stack is swiped through, no mechanism to load more.

**Fix Applied:**
1. Added displayLimit state to control how many events are shown
2. Added loadMoreEvents function that increases displayLimit
3. Auto-triggers when ~10 events remain in swipe stack
4. Added "Load More" button in grid view with remaining count
5. All filter changes reset displayLimit properly
6. Progress indicator now shows total count

---

### Issue 20: Profile Counters Misaligned
**Priority:** P3
**Status:** FIXED

**Files:**
- `src/pages/UnifiedProfile.css` - Stats section styling

**Root Cause:**
Numbers with different digit counts (e.g., "5" vs "100") appeared misaligned because proportional figures were used instead of tabular figures.

**Fix Applied:**
1. Added `font-variant-numeric: tabular-nums` to `.unified-profile-stat-value`
2. Added `min-width: 2ch` to ensure consistent minimum width
3. Applied same fix to `.unified-profile-stat-card-value` in Journey tab

---

### Issue 21: Streak Count Missing from Journey
**Priority:** P2
**Status:** FIXED

**Files:**
- `src/pages/UnifiedProfile.jsx:76-95` - loadStatsFromStorage function

**Root Cause:**
Variable name mismatch between streak tracking and display:
- Discover.jsx saves streak dates to `lastStreakDate`
- loadStatsFromStorage was checking `lastActivityDate` to reset streak
- This caused streak to never be properly validated/displayed

**Fix Applied:**
1. Changed loadStatsFromStorage to use `lastStreakDate` instead of `lastActivityDate`
2. Updated streak reset logic to match Discover.jsx:
   - If lastStreakDate is today: keep streak
   - If lastStreakDate is yesterday: keep streak (not broken yet)
   - Otherwise: reset streak to 0
3. Added comments explaining the logic

---

### Issue 22: Subscription Not Found Error
**Priority:** P0
**Status:** RESEARCHED

**Files:**
- `api/payments/create-portal.js:56-62` - Error handling
- `src/hooks/useSubscription.js` - Frontend handling

**Root Cause:**
When user clicks "Manage Subscription" but:
1. Has no stripe_customer_id (never subscribed) OR
2. Customer ID exists but no subscription history

API correctly rejects but error message is confusing.

**Fix Required:**
1. Check isPremium BEFORE allowing portal access
2. Show "Subscribe first" message instead of error
3. Redirect to pricing page for non-subscribers

---

### Issue 23: Saved Events Errors
**Priority:** P1
**Status:** FIXED

**Files:**
- `src/utils/savedEvents.js` - Storage utility
- `src/pages/Wishlist.jsx` - Events tab

**Root Cause:**
1. `getSavedEvents()` already had try/catch but `saveEvent()`, `unsaveEvent()`, and `clearSavedEvents()` did not
2. localStorage write operations could throw if quota exceeded or storage disabled
3. Wishlist.jsx already had proper error handling UI

**Fix Applied:**
1. Added try/catch to `saveEvent()` - now returns true/false success status
2. Added try/catch to `unsaveEvent()` - now returns true/false success status
3. Added try/catch to `clearSavedEvents()` - now returns true/false success status
4. All localStorage operations now gracefully handle errors
5. Wishlist.jsx already has `eventsError` state with retry button UI

---

### Issue 24: Lists Need Pagination
**Priority:** P1
**Status:** FIXED

**Files:**
- `src/pages/Wishlist.jsx` - Places/Events lists
- `src/pages/Wishlist.css` - Load more button styling
- `src/pages/Collections.jsx` - Collection items
- `src/pages/Collections.css` - Load more button styling
- `src/pages/Events.jsx` - Event stack (already fixed in Issue 19)

**Root Cause:**
All lists loaded everything at once, no pagination implemented.

**Fix Applied:**
1. Added `placesDisplayLimit` and `eventsDisplayLimit` state to Wishlist.jsx
2. Implemented PAGE_SIZE constant (12 items per page)
3. Places tab now shows first 12 items with "Load More (N remaining)" button
4. Events tab now shows first 12 items with "Load More (N remaining)" button
5. Filter/tab changes reset pagination to first page
6. Added pagination to Collections.jsx detail view (15 items per page)
7. Collection selection resets pagination
8. Animation delays capped to prevent slow renders on large lists
9. Added consistent load more button styling across both pages

---

### Issue 25: Premium Filters Broken
**Priority:** P1
**Status:** FIXED

**Files:**
- `src/components/FilterModal.jsx:385-409` - Premium filters UI
- `src/pages/Discover.jsx:200-252` - Filter application
- `src/utils/apiClient.js` - Place data parsing

**Root Cause:**
Premium filters depended on properties not included in parsed place data:
1. `p.tourism` - Only used to determine `p.type`, not stored separately
2. `p.brand` - Not included at all
3. `p.qualityScore` - Didn't exist

The condition `(p.qualityScore || 0) < 35` evaluated to `true` for all places, filtering everything out when "Locals' picks" was enabled.

**Fix Applied:**
1. Added `tourism`, `brand`, `fee` properties to parsed place data in apiClient.js
2. Implemented `calculatePlaceQuality()` function that scores places based on:
   - Contact info, opening hours, descriptions (+5-10 each)
   - Wikipedia/Wikidata links (+10-15 for notability)
   - Heritage/historical status (+15)
   - Chain/brand penalty (-20)
   - Tourist trap penalty (-10-15)
3. Fixed filter logic to only apply qualityScore check if score exists
4. Lowered quality threshold from 35 to 30
5. Added more chain name patterns to the filter

---

### Issue 26: No Itinerary Generation Indicator
**Priority:** P1
**Status:** RESEARCHED

**Files:**
- `src/pages/Plan.jsx:111` - isGenerating state
- `src/pages/Plan.jsx:539-541` - Generate button

**Root Cause:**
isGenerating state exists but button only shows "Generating..." text.
No spinner, no progress indication, no feedback.

**Fix Required:**
1. Add loading spinner to button
2. Add progress message
3. Show skeleton of itinerary while loading

---

### Issue 27: Itinerary Generation Fails/Slow
**Priority:** P0
**Status:** RESEARCHED

**Files:**
- `src/pages/Plan.jsx:163-220` - generate function
- `src/pages/Plan.jsx:170-173` - Timeout handling

**Root Cause:**
1. 30-second timeout may not be enough
2. Falls back to wishlist silently when API times out
3. No retry mechanism
4. No error toast on failure

**Fix Required:**
1. Increase timeout or implement progressive loading
2. Show clear error when timeout occurs
3. Add retry button
4. Consider caching itinerary results

---

### Issue 28: Saved Places Not in Itinerary
**Priority:** P1
**Status:** FIXED

**Files:**
- `src/pages/Plan.jsx:627-660` - Wishlist section
- `src/pages/Plan.css` - Wishlist styling

**Root Cause:**
1. Wishlist section hidden when `availableWishlist.length === 0`
2. Section only visible when user had available items
3. No empty state or CTA when wishlist empty

**Fix Applied:**
1. Always show "FROM YOUR WISHLIST" section regardless of wishlist count
2. Added three states:
   - Has items: Shows up to 6 items (was 4) with "+N more" link
   - All used: Shows "All your saved places are in the itinerary!"
   - Empty: Shows CTA to "Discover Places"
3. Added place type display on each wishlist item
4. Added coordinate validation (disabled button if no lat/lng)
5. Enhanced styling with golden gradient background
6. Shows total wishlist count in "View All" link

---

### Issue 29: No Add Saved to Collection
**Priority:** P2
**Status:** FIXED

**Files:**
- `src/pages/Wishlist.jsx` - Added collection button and modal
- `src/pages/Wishlist.css` - Added collection button styling
- `src/components/CollectionManager.jsx` - Already existed

**Root Cause:**
No UI to add saved places to collections from Wishlist, despite CollectionManager component already existing.

**Fix Applied:**
1. Added CollectionManager import to Wishlist.jsx
2. Added FolderPlusIcon for the collection button
3. Added state for selectedPlace and showCollectionManager
4. Added openCollectionManager handler function
5. Added folder+ button to each wishlist card between Go and Remove
6. Renders CollectionManager modal when button is clicked
7. Added collection button CSS with gold accent on hover

---

### Issue 30: Notification System
**Priority:** P2
**Status:** FIXED

**Files:**
- `api/notifications/index.js` - Notifications API (same as Issue 10)
- `src/hooks/useNotifications.js` - React hook for notifications
- `src/components/NotificationBell.jsx` - Bell icon + dropdown panel
- `src/components/NotificationBell.css` - Notification styling

**Fix Applied:**
1. Created `api/notifications/index.js` with:
   - GET: Fetch paginated notifications with unread count
   - POST `mark_read`: Mark specific notifications as read
   - POST `mark_all_read`: Mark all notifications as read
   - `createNotification` helper for other APIs to create notifications
2. Created `useNotifications` hook with:
   - Fetch notifications with pagination
   - Polling for new notification count (60s interval)
   - Mark as read functionality
3. Created NotificationBell component with:
   - Bell icon with unread badge
   - Dropdown panel with notification list
   - Loading, empty, and error states
   - Mobile responsive (bottom sheet on small screens)
4. Integrated into Activity page header

**Database Requirement:**
The notifications table schema should be:
```sql
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  actor_id INT,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  message TEXT,
  data JSON,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);
```

---

### Issue 31: SEO
**Priority:** P3
**Status:** FIXED

**Files:**
- `src/hooks/useSEO.js` - Custom SEO hook (React 19 compatible)
- `src/pages/Place.jsx` - Dynamic SEO for place pages
- `src/pages/SharedPlan.jsx` - Dynamic SEO for shared plans
- `src/pages/UnifiedProfile.jsx` - Dynamic SEO for user profiles
- `index.html` - Base meta tags (already well configured)

**Root Cause:**
SPA with static meta tags. Dynamic pages needed route-specific metadata.

**Fix Applied:**
1. Created `useSEO` hook (react-helmet-async doesn't support React 19 yet)
2. Hook dynamically updates document.title and meta tags
3. Properly restores original values on unmount
4. Applied to shareable pages:
   - **Place pages**: Title = place name, description includes place details
   - **Shared plans**: Title = plan name, description shows place count
   - **User profiles**: Title = display name + username, description shows stats

**Limitations:**
- Search engine crawlers may not execute JS (SSR would help)
- OG images not dynamically generated (would need server-side rendering)
- JSON-LD structured data not implemented (future enhancement)

---

## Implementation Order

### Phase 1: P0 - App Breaking (Do First)
1. Issue 22: Subscription error (quick fix)
2. Issue 1: Driving mode (API fix)
3. Issue 27: Itinerary generation (timeout/retry)
4. Issues 2-3: Performance (high effort but critical)

### Phase 2: P1 - Core Experience
5. Issue 15: Maps navigation (quick)
6. Issue 26: Generation indicator (quick)
7. Issue 6-7: PWA icons/prompt
8. Issue 4: Settings page (medium)
9. Issue 18-19: Events dedup + load more
10. Issue 25: Premium filters
11. Issue 28: Saved places in itinerary
12. Issue 23: Saved events errors
13. Issue 24: Pagination (high effort)

### Phase 3: P2 - Polish
14. Issue 5: Duplicate settings buttons
15. Issue 13-14: Milestones
16. Issue 17: iPhone SE spacing
17. Issue 21: Streak count
18. Issue 29: Collection integration
19. Issues 8-11: Social features (high effort)
20. Issue 30: Notification system (high effort)

### Phase 4: P3 - Nice to Have
21. Issue 16: Duplicate emoji
22. Issue 20: Counter alignment
23. Issue 12: Location usage
24. Issue 31: SEO

---

## Current Status

**Researched:** 31/31 issues
**Fixed:** 30/31 issues
**WONTFIX:** 1/31 issues (Issue 12 - product decision)
**In Progress:** 0/31 issues

### All Issues Addressed

| Status | Count | Issues |
|--------|-------|--------|
| FIXED | 30 | 1-11, 13-31 |
| WONTFIX | 1 | 12 (product roadmap item, not a bug) |

**Database Requirements:**
- Issue 30 (notifications) requires a `notifications` table. Schema documented in issue details.
- Issues 8-11 (social features) require existing `users`, `follows`, and `contributions` tables.
