# ROAM Product Analysis & Feature Roadmap

> **Vision**: Transform ROAM into THE discovery platform that empowers people to explore, combat boredom, and improve quality of life.

---

## Current State Summary

ROAM is a well-built React app with solid foundations:
- **Discover**: Swipe-based discovery with "I'm Bored" button, category filters, travel mode settings
- **Plan**: Adventure builder with vibes (Food Crawl, Culture Day, etc.) and time-based itineraries  
- **Wishlist**: Saved places with Google Maps navigation
- **Profile**: Gamification with badges, streaks, levels, and stats

**Tech Stack**: React 19 + Vite, Framer Motion, Overpass API (OSM), OpenTripMap, Open-Meteo (weather)

---

## 🔍 Comprehensive UX Audit (January 2026)

> Deep analysis from code review and thorough browser testing with full page scrolling.

### Page-by-Page Element Ordering Analysis

#### **Discover Page (`/`)**
**Element Order (top to bottom):**
1. Settings icon (top-left) → ROAM wordmark (center, serif) → "Discover your next adventure" tagline (italic)
2. "I'm Bored" button (🎲 dice emoji, coral gradient, centered hero CTA)
3. Weather/Mode status pills (e.g., "9° Partly cloudy", "🚶 Walking")
4. Category filter pills (horizontal scroll): Food & Drink → Nature → Arts & Culture → History → Entertainment → Nightlife → Active & Sports
5. Card stack with top card showing: Image → Category pill → Place name → Distance/Type → Address
6. Action buttons (left→right): Skip (red X) → Go Now (gold plane) → Wishlist (green heart)
7. Progress indicator: "1 of 30"

**Code Reference**: [`Discover.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Discover.jsx) lines 321-577

#### **Plan Page (`/plan`)**
**Element Order (top to bottom):**
1. Header: "Plan an Adventure"
2. Vibe selection grid: Mix It Up → Food Crawl → Culture Day → Outdoor Adventure → Chill Vibes
3. Duration row: 2 hours (2 stops) → Half day (3 stops) → Full day (4 stops) → Epic day (5 stops)
4. "Build My Adventure" button (dark green)
5. **Below the fold**: "Recent Adventures" section (hidden until scroll)

**Critical Issue**: Recent Adventures is completely hidden without scrolling - users may never discover they can access saved adventures.

**Code Reference**: [`Plan.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Plan.jsx) lines 380-408

#### **Wishlist Page (`/wishlist`)**
**Element Order:**
1. Header: "Wishlist" + "X places saved" count
2. Category filter pills (only shown if items exist)
3. Grid of wishlist cards OR empty state (heart icon + instructional text)

**Empty state messaging** is good but lacks a direct CTA button to navigate to Discover.

**Code Reference**: [`Wishlist.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Wishlist.jsx) lines 194-201

#### **Profile Page (`/profile`)**  
**Element Order (top to bottom):**
1. Header: "Your Journey"
2. Level card (dark green background) with level number, title, progress bar
3. Stats visualization grid: VisitedMap + CategoryChart (placeholders when empty)
4. Extended stats: DistanceStats + MonthlyTrends
5. Numeric stats grid: Places Visited / Day Streak / Boredom Busts / Saved Places
6. Badges section: Earned badges → Locked badges (6 badges: Getting Into It, Week Warrior, Unstoppable, Spontaneous, Curator, Planner)
7. Best Streak highlight (if applicable)
8. Motivational message

**Code Reference**: [`Profile.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Profile.jsx) lines 71-199

---

### 🐛 Critical Bugs Found in Code

#### **1. Plan Page Walk Time Logic Failure**
**Location**: [`Plan.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Plan.jsx) lines 115-127, 215-221

**Problem**: The adventure builder shows absurdly long walk times (observed: **156-194 minutes** between stops for a 4-hour adventure).

```javascript
// Line 120: Hardcoded 90 minutes per stop regardless of actual distance
time.setMinutes(time.getMinutes() + (index * 90)) // 90 mins per stop

// Lines 215-221: getTravelTime calculates walking time but doesn't cap it
const getTravelTime = (from, to) => {
  const dist = calculateDistance(from.lat, from.lng, to.lat, to.lng)
  const walkingSpeed = 5 // km/h
  const minutes = Math.round((dist / walkingSpeed) * 60)
  return minutes  // NO MAXIMUM LIMIT - returns 194 if places are far apart
}
```

**Root Cause**: 
- `getRandomQualityPlaces()` selects places without distance constraints
- `optimizeRoute()` orders by nearest-neighbor but doesn't reject distant combinations
- No validation that total walk time fits within adventure duration

**Impact**: Users get unusable itineraries where walking time exceeds activity time.

#### **2. shuffleStop Rebuilds Entire Adventure**
**Location**: [`Plan.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Plan.jsx) lines 188-192

```javascript
const shuffleStop = () => {
  // This would swap the stop with another random place
  // For now, just rebuild the whole adventure
  buildAdventure()  // ← Destroys entire itinerary instead of swapping one stop
}
```

**Impact**: Clicking the shuffle icon on any stop regenerates the whole adventure, losing all other stops. User expectation is to swap just that one stop.

---

### ⚠️ Accessibility Violations

#### **Profile Level Card Contrast Failure**
**Location**: [`Profile.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Profile.jsx) lines 84-93, [`Profile.css`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/pages/Profile.css)

**Problem**: Text on the dark green level card fails WCAG AA contrast requirements:
- "Level 1 Explorer" title (light text on `#2D5A3D` green background)
- "X more activities to level up" subtitle

**Impact**: Text is nearly illegible, especially for users with vision impairments.

---

### 📐 Layout & UX Issues

| Page | Issue | Severity | Details |
|------|-------|----------|---------|
| Plan | Recent Adventures hidden | Medium | Requires scrolling to discover; no visual hint it exists |
| Plan | Walk times show "194 min walk" | Critical | No sanity check on walking time between stops |
| Wishlist | Empty state lacks CTA | Low | Message tells users to swipe, but no button to go to Discover |
| Profile | Empty stats are large blocks | Medium | YOUR MAP / CATEGORIES show placeholder text in large empty cards |
| Profile | 6 locked badges dominate | Low | New users see mostly "🔒" which feels demotivating |
| Discover | No feedback on category filter | Low | If filter returns no results, user just sees empty stack |

---

### 🎯 Boredom Buster Modal Analysis
**Location**: [`BoredomBuster.jsx`](file:///Users/jamesfitton/Documents/weekend-adventure-planner/src/components/BoredomBuster.jsx)

**What Works**:
- Contextual reason text based on weather/time (lines 46-79)
- Background image with overlay creates premium feel
- Close button, Let's Go, and Try Another actions

**Issues**:
- No distance capping for suggestions (can suggest places far away)
- Reason text sometimes generic ("A perfect spot for right now")
- No loading skeleton - just dice animation

---

## 🚨 Critical UX Issues to Fix

### 1. First-Time User Experience (FTUE)
**Problem**: No onboarding. Users land on the Discover page with no guidance.

**Recommendation**:
- Add 3-slide onboarding explaining swipe gestures
- Request location permissions with context ("Find adventures near you")
- Let users pick initial interests/categories
- Quick win: Show a "Welcome, explorer!" modal on first launch

### 2. Empty States Are Demotivating
**Problem**: If no places load, the user just sees an empty card stack.

**Recommendation**:
- Add engaging empty states with helpful messaging
- "No places nearby? Try increasing your travel radius in Settings"
- Offer a "Retry" or "Explore further" button

### 3. No Feedback Loop for "Go" Actions
**Problem**: When user swipes up to "Go Now", they just get navigation. No confirmation they've actually visited.

**Recommendation**:
- Add a "Mark as Visited" feature
- Show a celebration animation after visiting
- Ask for a quick rating (👍/👎) to improve future recommendations

### 4. Bug: BoredomBuster Uses Wrong Function
**Problem**: `Discover.jsx` calls `fetchNearbyPlaces` in the boredom buster but should use `fetchEnrichedPlaces`.

**Fix**: Update lines 202 and 241 in `Discover.jsx` to use `fetchEnrichedPlaces`.

---

## 💡 High-Impact Feature Ideas

### Tier 1: Core Flow Improvements

#### 1. "Mood-Based Discovery" on Home Screen
Instead of just category chips, add mood/vibe quick-selects:
- 🌅 *"I want to chill"* → Parks, cafes, beaches
- ⚡ *"I need adventure"* → Active, unique, entertainment
- 👫 *"I'm with friends"* → Nightlife, entertainment, food
- ❤️ *"Date night"* → Restaurants, bars, culture
- 👨‍👩‍👧 *"Family day out"* → Family-friendly filters

#### 2. "Surprise Me" with More Personality
The "I'm Bored" button is great but could be **way** more engaging:
- Add a spinning wheel/slot machine animation
- Give the result narrative flair: *"How about discovering this hidden gem 15 min away?"*
- Include a "Why this?" explanation based on weather, time of day, recent activity

#### 3. Smart Time-Aware Suggestions
Leverage the existing weather API more deeply:
- Morning: Coffee spots, parks, scenic walks
- Lunchtime: Restaurants, cafes, markets
- Evening: Bars, restaurants, entertainment
- Rainy day: Museums, cinemas, indoor activities
- Sunny weekend: Parks, viewpoints, outdoor activities

#### 4. "Day Trip Builder" for Drivers
Add a specific **driving mode** with:
- 30-60 min radius "Road Trip" adventures
- Multi-stop routes optimized for scenic drives
- UK-specific: Coastal drives, countryside routes, national trust sites
- Fuel stop suggestions along the way
- Estimated drive times between stops

---

### Tier 2: Engagement & Retention

#### 5. Weekly "Adventure Challenge"
Gamification beyond badges:
- *"Visit 3 new places this week"*
- *"Try a new category you've never explored"*
- *"Go somewhere over 20km away"*
- Weekly themed challenges: "Cafe Hop Week", "History Hunt"

#### 6. Social Sharing & Community
- "Share your adventure" - generate Instagram-ready summary cards
- "I'm at..." status for friends (opt-in)
- Community-submitted "hidden gems" with upvoting
- Local "explorer" leaderboards

#### 7. Personal Stats Dashboard
Expand the Profile page:
- Heat map of visited areas
- Category breakdown pie chart
- "Total distance explored"
- "New places discovered this month"
- Monthly/yearly review: "Your 2026 in exploration"

#### 8. Saved "Routes" / "Collections"
Let users build curated lists:
- "Coffee spots I love"
- "Date night ideas"
- "Places to take visitors"
- Share collections with friends

---

### Tier 3: Discovery Quality Improvements

#### 9. Better Place Enrichment
Current images are placeholder URLs. Improve with:
- Fetch actual photos from Wikipedia/Wikidata 
- Use OpenTripMap's image endpoints
- Allow user-submitted photos
- Fallback to Street View thumbnails

#### 10. "Why You'll Love This" AI-Generated Blurbs
If a place lacks a description:
- Generate context: "A traditional English pub dating back to 1780, known for its cozy atmosphere"
- Highlight what makes it special
- Use existing OSM tags (heritage, historic, etc.)

#### 11. Opening Hours Intelligence
Current `isOpen` flag exists but needs work:
- Parse `opening_hours` tag properly
- Show "Closes in 30 min" warnings
- Filter to "Open Now" by default
- "Open late" category for night owls

#### 12. User Ratings & Mini-Reviews
- After visiting, prompt: *"Would you recommend this?"*
- Thumbs up/down + optional short review
- Show aggregate ratings on cards
- "X explorers loved this"

---

### Tier 4: Economic & Community Impact

#### 13. Support Local Business Badges
Align with your vision to stimulate the economy:
- "Local Independent" badge for non-chains
- "Family-owned" indicators
- "Support Small" filter
- Partner with local tourism boards

#### 14. Events & "What's On"
Integrate local events:
- Farmers markets (specific days)
- Festivals
- Pop-up events
- Local events API integration (e.g., local council feeds, venue partners)

#### 15. Seasonal Discovery
- Autumn: *"Best spots for autumn colours"*
- Winter: *"Cozy indoor escapes"*
- Summer: *"Lido season is here!"*
- Bank holidays: *"Long weekend adventures"*

---

## 🔧 Technical Quick Wins

| Issue | Current State | Fix |
|-------|--------------|-----|
| No PWA manifest | Just meta tags | Add `manifest.json` for full PWA install |
| Location fallback | Defaults to London | Let user manually set location |
| No offline support | Requires network | Cache recent places in localStorage |
| No search | Discovery only | Add "Search places" functionality |
| BoredomBuster bug | Uses wrong fetch function | Use `fetchEnrichedPlaces` instead |

---

## 📱 UX Polish Suggestions

1. **Haptic feedback** on swipe actions (if mobile)
2. **Pull-to-refresh** on Discover page
3. **Skeleton loaders** instead of just spinners
4. **Card flip animation** on tap for more details
5. **Confetti animation** when completing challenges
6. **Dark/Light mode toggle** based on time of day
7. **Accessibility audit** - ensure screen reader support

---

## 🎯 Priority Roadmap

### Phase 1: Foundation (1-2 weeks) ✅ COMPLETE
- [x] Fix `fetchNearbyPlaces` bug in BoredomBuster
- [x] Add toast notification system for error feedback
- [x] Add location fallback banner when using default location
- [x] Plan.jsx empty state + loading polish
- [x] Add onboarding flow (3-slide intro + interest selection)
- [x] Improve empty states (Discover page with actionable buttons)
- [x] Add "Mark as Visited" after navigation (with rating + confetti celebration)

### Phase 2: Engagement (2-4 weeks)
- [ ] Implement mood-based discovery
- [ ] Add weekly challenges
- [ ] Enhance stats dashboard with visualizations
- [ ] Add collections/saved routes

### Phase 3: Discovery Quality (4-6 weeks)
- [ ] Improve image fetching pipeline
- [ ] Better opening hours parsing
- [ ] User ratings system
- [ ] Day trip builder for drivers

### Phase 4: Community (6+ weeks)
- [ ] Social sharing features
- [ ] Local business badges
- [ ] Events integration
- [ ] Community submissions

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/pages/Discover.jsx` | Main discovery page with swipe cards and "I'm Bored" |
| `src/pages/Plan.jsx` | Adventure builder with vibes/durations |
| `src/pages/Profile.jsx` | Stats, badges, gamification |
| `src/pages/Wishlist.jsx` | Saved places management |
| `src/components/SwipeCard.jsx` | Swipe card UI and gestures |
| `src/components/BoredomBuster.jsx` | "I'm Bored" modal overlay |
| `src/utils/apiClient.js` | All API integrations (OSM, OpenTripMap, Wikipedia) |
| `src/utils/categories.js` | Place category definitions and filtering |
| `src/utils/placeFilter.js` | Scoring and filtering logic |

---

## Questions to Consider

1. **Monetization**: Free forever? Premium tier? Local business partnerships?
2. **Data strategy**: Should users create accounts for sync across devices?
3. **UK-only?**: Will this expand to other countries?
4. **Native app?**: PWA or native iOS/Android apps in future?

---

*This app has strong bones. The vision of fighting boredom and empowering exploration is compelling. Focus on the "aha moment" - that first successful discovery that makes users want to come back.*
