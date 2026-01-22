# ROAM Product Roadmap

> **Vision**: A community-driven local discovery platform where users tell each other why places matter.

---

## 🤖 AI Agent Instructions

**READ THIS FIRST** — This section is for Claude, Cursor, Copilot, and any AI assistants working on this project.

### Your Role

You are a collaborator on ROAM, a local discovery platform. The human developer (James) has a vision but limited time. Your job is to:

1. **Understand the vision** before writing code
2. **Maintain momentum** across sessions (context may be lost)
3. **Document everything** you do
4. **Ask when uncertain** rather than guess

### Before Starting Any Work

1. **Read this roadmap** — Understand where we are and where we're going
2. **Check the change log** (below) — See recent work and decisions
3. **Check git history** — `git log --oneline -20` for recent commits
4. **Identify the current phase** — We work sequentially through phases

### Key Principles

| Principle | Why |
|-----------|-----|
| Community over editorial | Users curate, not us — we don't have expertise |
| Simple over clever | This needs to ship, not be perfect |
| Mobile-first | Most users will be on phones |
| UK scope | Start small, expand later |
| Pseudonymous | @usernames, not real names |

### Code Patterns to Follow

```javascript
// API calls go through the client
import { apiClient } from '../utils/apiClient'

// State management is React context + hooks
import { useAuth } from '../hooks/useAuth'

// Animations use Framer Motion
import { motion } from 'framer-motion'

// Styling is CSS modules or inline for small things
import styles from './Component.module.css'
```

### File Organization

```
src/
├── components/    # Reusable UI components
├── pages/         # Route-level components
├── hooks/         # Custom React hooks
├── utils/         # Pure functions, API clients
├── contexts/      # React contexts (auth, theme, etc.)
├── data/          # Static data, constants
└── lib/           # Third-party integrations (Supabase)
```

### When You Complete Work

1. **Update the change log** (below) with what you did
2. **Update phase checkboxes** if you completed items
3. **Commit with clear messages** explaining the "why"
4. **Note any blockers** or decisions for the next session

### How to Handle Uncertainty

- **Technical decision?** Make a reasonable choice, document it in the change log
- **Product decision?** Ask the user — don't assume
- **Missing context?** Read git history and recent files before asking

### Common Pitfalls to Avoid

- Don't over-engineer — we're building an MVP
- Don't add features not in the roadmap without asking
- Don't forget mobile — test in responsive mode
- Don't break existing functionality — the app should always work

---

## 📋 Change Log

Track all significant changes here. Most recent first.

### January 2026

**[2026-01-22]** — Phase 4: Social Features ✅ COMPLETE
- Created database schema for social features (`database/phase4-social.sql`)
  - `follows` table for user-to-user follows
  - `activity_log` table for tracking activity
- Created social API (`api/social/index.js`)
  - GET: followers, following, activity feed, user discovery
  - POST: follow/unfollow users
- Created public user profile API (`api/users/[username].js`)
  - Returns profile data, stats, contributions
  - Includes follow status for authenticated users
- Created `useSocial` hooks (`src/hooks/useSocial.js`)
  - `useFollow()`: Follow/unfollow users
  - `useUserProfile(username)`: Fetch public profile
  - `useFollowers(userId)`: Fetch user's followers
  - `useFollowing(userId)`: Fetch who user follows
  - `useActivityFeed()`: Activity from followed users
  - `useDiscoverUsers()`: "People Like You" recommendations
- Built FollowButton component with optimistic updates
- Built UserCard component for user lists
- Built ActivityFeed component
- Created UserProfile page (`src/pages/UserProfile.jsx`)
- Created Activity page (`src/pages/Activity.jsx`) with feed and discover tabs
- Updated Profile page with social stats (followers, following, tips count)
- Added routes: `/user/:username`, `/activity`

**[2026-01-22]** — Phase 3: Community Features ✅ COMPLETE
- Created contributions API (`api/contributions/index.js`)
  - GET: Fetch contributions for a place or user, includes vote status
  - POST: Create contribution (tip/story/photo/correction)
  - POST with action='vote': Upvote/downvote contributions
- Created `useContributions` hooks (`src/hooks/useContributions.js`)
  - `useContributions(placeId)`: Fetch contributions for a place
  - `useUserContributions(userId)`: Fetch user's contributions
  - `useCreateContribution()`: Create new contribution
  - `useVote()`: Vote on contributions
- Built `ContributionPrompt` component for sharing tips after visits
- Built `ContributionDisplay` components (ContributionBadge, ContributionCard, ContributionList)
- Integrated "Share a tip" step into VisitedPrompt flow
- Added community tips section to PlaceDetail view
- Added "Your Tips" section to Profile page
- Consolidated API routes to stay under Vercel Hobby 12-function limit:
  - Merged vote.js into contributions/index.js
  - Merged all auth endpoints into auth/index.js (login, register, google, logout, me)
- Added sign-in step to onboarding flow

**[2026-01-22]** — Phase 2: Saved Places Migration ✅ COMPLETE
- Created saved places API (`api/places/saved.js`) - GET/POST/DELETE
- Created migration endpoint (`api/places/saved/migrate.js`)
- Built `useSavedPlaces` hook for unified localStorage/API abstraction
- Updated Discover.jsx and Wishlist.jsx to use new hook
- Migration triggers automatically on first login
- Anonymous users continue using localStorage (zero friction)

**[2026-01-22]** — Phase 2: Backend & Auth (MySQL)
- **Pivoted from Supabase to MySQL** — User hit Supabase free tier limit
- Using user's existing MySQL database (AWS RDS)
- Created database connection utility (`api/lib/db.js`)
- Created MySQL schema (`database/schema.sql`) with all required tables
- Built auth API routes: `/api/auth/register`, `/api/auth/login`, `/api/auth/google`, `/api/auth/me`, `/api/auth/logout`
- Created `AuthContext` with full auth state management
- Built `AuthModal` component for login/signup UI with Google SSO support
- Integrated auth into app with AuthProvider wrapper
- Added auth UI to Profile page (Sign in/Sign up buttons, user info display)
- Auth supports: email/password + Google SSO, JWT tokens with httpOnly cookies

**[2026-01-22]** — Technical Debt: Error handling, Accessibility, Performance
- Added ErrorBoundary component for graceful error recovery
- Created standardized LoadingState component with multiple variants
- Fixed accessibility issues: alt text, aria-labels, skip link, semantic HTML
- Implemented code splitting with React.lazy for all page components
- Fixed 21 lint errors across the codebase

**[2026-01-22]** — UI Fix: BoredomBuster small screen layout
- Fixed "I'm Bored" result screen overflowing on iPhone SE
- Added responsive styles for short viewports (max-height: 700px, 570px)
- On very small screens, hides description/reason text to fit
- Clamp-based spacing + stable viewport height to keep actions visible on modern iPhones

**[2026-01-22]** — Auth Hardening: Google SSO on Vercel
- Added token fallback (Authorization header) when cookies fail to persist
- Added configurable auth cookie domain + SameSite via env vars
- Fixed Google popup flow to avoid browser blocking after One Tap callbacks
- Bumped service worker cache version + network-first navigations to avoid stale auth code

**[2026-01-22]** — Critical Bug Fix: Missing motion import
- **Root cause found**: `motion` was not imported in App.jsx but used in LocationBanner
- This caused a JavaScript crash when location permission was denied/timed out
- Explains blank screen on Safari/iPhone SE after "Start Exploring"
- One-line fix: added `motion` to framer-motion import

**[2026-01-22]** — Bug Fix: Onboarding & Location Issues
- Fixed onboarding interests screen button cut-off on iPhone (small screens)
- Made onboarding overlay scrollable with safe area insets
- Fixed blank screen after onboarding when location not yet available
- Added "Getting your location" pending state with helpful message
- Added fallback for browsers without geolocation support

**[2026-01-22]** — Session: Foundation Work
- Created `/docs/ROADMAP.md` (this file)
- Added PWA support: `manifest.json`, `sw.js`, `icon.svg`
- Updated `index.html` with PWA links and service worker registration
- **Decision**: Community curation over editorial — users tell each other why places matter
- **Decision**: Supabase for backend (Postgres, auth, realtime)
- **Decision**: UK-wide scope from start
- **Decision**: Pseudonymous accounts (@username style)
- **Next**: Set up Supabase project and auth flow

**[2026-01-21]** — Events & Filtering
- Added Events page with category filtering
- Integrated Ticketmaster, Skiddle, Eventbrite APIs
- Added unified saved content management
- Fixed security issues with API proxies
- Note: Skiddle/Eventbrite show 500 errors — need env vars in Vercel

---

## 📊 Current Status

**Phase**: 4 (Social Features) — ✅ COMPLETE

**What's Working**:
- ✅ Place discovery with swipe cards
- ✅ Event aggregation
- ✅ Category filtering
- ✅ Weather-aware recommendations
- ✅ PWA installable on mobile
- ✅ Offline caching (basic)
- ✅ Auth API routes (register, login, Google SSO)
- ✅ Auth UI (modal with email/password + Google)
- ✅ AuthContext for state management
- ✅ Saved places synced to database for logged-in users
- ✅ "Share a tip" prompt after marking place as visited
- ✅ Community tips displayed on PlaceDetail
- ✅ Upvote/downvote on contributions
- ✅ User's contributions shown on Profile page
- ✅ Sign-in option in onboarding flow
- ✅ Public user profiles (`/user/:username`)
- ✅ Follow/unfollow other users
- ✅ Activity feed from followed users
- ✅ "People Like You" recommendations
- ✅ Social stats on Profile page

**What's Next** (Phase 5: Growth Features):
- ⏳ Trending & Popular places
- ⏳ Social sharing
- ⏳ PWA enhancements (push notifications, offline maps)

**Blockers**:
- None currently

---

## What We Have

A working discovery app with:
- Swipe-based place discovery (Tinder for places)
- Event aggregation (Ticketmaster, Skiddle, Eventbrite)
- Weather-aware recommendations
- Category filtering
- Wishlist and collections
- Clean, warm aesthetic

**Tech Stack**: React 19, Vite, Framer Motion, Vercel serverless

---

## What's Missing

The **soul**. Currently shows "Pub, 1.4km" when it should show "Pub where Dickens drank, Victorian bar upstairs, 1.4km".

The solution isn't editorial curation (doesn't scale, requires expertise). It's **community curation** - users telling each other what makes places special.

---

## The Model

```
Discovery App (Now)
       ↓
Community Platform (Next)
       ↓
Business Platform (Later)
       ↓
Native Apps (When Proven)
```

---

## Phase 1: Foundation ✅ COMPLETE

### PWA Support
Make it installable on phones without app stores.

- [x] Basic app structure
- [x] manifest.json with app metadata
- [x] Service worker for offline caching
- [x] "Add to Home Screen" support
- [x] App icon (compass design in brand colors)

### Files Created
- `/public/manifest.json` - App manifest with shortcuts
- `/public/sw.js` - Service worker with caching strategies
- `/public/icons/icon.svg` - Compass icon
- `/index.html` - Updated with PWA links

### Verification
To verify PWA is working:
1. Run `npm run build && npm run preview`
2. Open in Chrome, check DevTools > Application > Manifest
3. On mobile, verify "Add to Home Screen" appears
4. Install and verify standalone mode works

---

## Phase 2: Backend & Auth ✅ COMPLETE

### MySQL Integration (Changed from Supabase)
Replace localStorage with real database.

**Why MySQL (changed from Supabase):**
- User hit Supabase free tier limit (2 projects max)
- Already has MySQL database hosted via AWS RDS
- Full control over database schema
- No vendor lock-in
- Using `mysql2` package for serverless-friendly connections

**Stack:**
- MySQL 8.x on AWS RDS
- JWT authentication with httpOnly cookies
- bcryptjs for password hashing
- google-auth-library for Google OAuth

### Step-by-Step Setup

**Step 1: Create Supabase Project**
1. Go to [supabase.com](https://supabase.com)
2. Create new project (name: "roam-app")
3. Save the Project URL and anon key
4. Add to `.env.local`:
   ```
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=xxx
   ```

**Step 2: Install Dependencies**
```bash
npm install @supabase/supabase-js
```

**Step 3: Create Supabase Client**
Create `/src/lib/supabase.js`:
```javascript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

**Step 4: Run Database Migrations**
In Supabase SQL Editor, run the schema below.

**Step 5: Configure Auth**
In Supabase Dashboard > Authentication:
- Enable Email provider
- Enable Google provider (optional)
- Set redirect URL to your domain

**Step 6: Create Auth Context**
See "Files to Create" below for implementation.

### Database Schema

```sql
-- User profiles (extends Supabase auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Place contributions ("Why this place?")
CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT NOT NULL,
  user_id UUID REFERENCES profiles NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) <= 280),
  upvotes INT DEFAULT 0,
  downvotes INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Votes on contributions
CREATE TABLE votes (
  user_id UUID REFERENCES profiles,
  contribution_id UUID REFERENCES contributions,
  vote SMALLINT CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, contribution_id)
);

-- User follows
CREATE TABLE follows (
  follower_id UUID REFERENCES profiles,
  following_id UUID REFERENCES profiles,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- Saved places (replaces localStorage)
CREATE TABLE saved_places (
  user_id UUID REFERENCES profiles,
  place_id TEXT NOT NULL,
  note TEXT,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, place_id)
);

-- Saved events
CREATE TABLE saved_events (
  user_id UUID REFERENCES profiles,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  event_data JSONB,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);
```

### Auth Flow

1. Browse without account (full discovery access)
2. Prompt to sign up when user tries to:
   - Save more than 5 places
   - Contribute a "why"
   - Upvote/downvote
   - Follow someone
3. Sign up options: Email, Google, Apple
4. Username selection (pseudonyms, @localmark style)

### Files to Create
- `/src/lib/supabase.js` - Supabase client
- `/src/contexts/AuthContext.jsx` - Auth state management
- `/src/components/AuthModal.jsx` - Sign up/login UI
- `/src/hooks/useAuth.js` - Auth helpers

---

## Phase 3: Community Features ✅ COMPLETE

### "Why This Place?" Flow

After marking a place as visited:
```
┌────────────────────────────────┐
│  You visited The Lamb & Flag   │
│                                │
│  What made it special?         │
│  ┌──────────────────────────┐  │
│  │ Best pint in Covent...   │  │
│  └──────────────────────────┘  │
│  140 characters                │
│                                │
│  [Skip]              [Share]   │
└────────────────────────────────┘
```

### Display on Cards

```
┌────────────────────────────────┐
│  [Image]                       │
│                                │
│  The Lamb & Flag               │
│  Pub · 1.4km                   │
│                                │
│  "Best pint in Covent Garden,  │
│   been coming 20 years"        │
│   — @localmark · ↑47           │
└────────────────────────────────┘
```

### Upvote/Downvote

- Tap contribution to expand
- Upvote = "This helped me"
- Downvote = "Not useful"
- Score = upvotes - downvotes
- Top contribution shown on card
- View all contributions in detail view

### Files to Create
- `/src/components/ContributionPrompt.jsx`
- `/src/components/ContributionDisplay.jsx`
- `/src/components/VoteButtons.jsx`
- `/src/hooks/useContributions.js`

---

## Phase 4: Social ✅ COMPLETE

### User Profiles

```
┌────────────────────────────────┐
│  @localmark                    │
│  "Coffee snob, pub enthusiast" │
│                                │
│  47 contributions · 12 saves   │
│  234 helpful votes received    │
│                                │
│  [Follow]                      │
│                                │
│  Recent contributions:         │
│  • The Lamb & Flag            │
│  • Borough Market Coffee       │
│  • ...                         │
└────────────────────────────────┘
```

### Following & Feed

- Follow users whose taste you trust
- "People you follow loved this"
- Activity feed of recent contributions

### "People Like You"

- Track user preferences (categories, ratings)
- Find similar users
- Surface their recommendations

### Files to Create
- `/src/pages/Profile.jsx` - User profile page
- `/src/pages/Activity.jsx` - Activity feed
- `/src/components/UserCard.jsx`
- `/src/components/FollowButton.jsx`
- `/src/hooks/useFollow.js`

---

## Phase 5: Growth Features (Week 6-8)

### Trending & Popular

- "Hot in your area this week"
- "Rising" places (sudden engagement spike)
- Category-specific trends

### Sharing

- Share place cards to social
- Share collections
- Deep links to places/profiles

### PWA Enhancements

- Offline mode (cached places)
- Push notifications (new followers, upvotes)
- Background sync

---

## Phase 6: Business Layer (Week 8+)

### Owner Claims

1. Owner requests claim
2. Verification (phone/email on listing)
3. Owner dashboard unlocked

### Owner Features

- "Owner says:" pitch (clearly marked)
- Response to contributions
- View analytics (views, saves, engagement)
- Featured placement (paid)

### Monetization

| Feature | Model |
|---------|-------|
| Featured placement | Monthly subscription |
| Analytics dashboard | Premium tier |
| Promoted events | Pay per impression |
| Tourism board partnerships | Enterprise deals |

---

## Phase 7: Native Apps (When Proven)

### Why Wait?

- Validate community features on web first
- PWA covers 80% of mobile use cases
- Native development is expensive
- App store approval is slow

### When Ready

**Stack:**
```
React Native 0.74+ (or Expo)
├─ React Navigation
├─ Reanimated 3
├─ AsyncStorage
├─ expo-sqlite
└─ Existing Vercel backend
```

**Timeline:** 6-7 weeks for experienced RN developer

**Reusable Code:** ~80% of `/src/utils`

---

## User Tiers

| Feature | Anonymous | Free Account | Premium |
|---------|-----------|--------------|---------|
| Browse & discover | ✓ | ✓ | ✓ |
| See contributions | ✓ | ✓ | ✓ |
| Save places | 5 max | Unlimited | ✓ |
| Contribute "why" | ✗ | ✓ | ✓ |
| Upvote/downvote | ✗ | ✓ | ✓ |
| Follow users | ✗ | ✓ | ✓ |
| Collections | ✗ | 3 max | Unlimited |
| Offline maps | ✗ | ✗ | ✓ |

---

## Success Metrics

### Phase 1-2 (Foundation)
- App installable on mobile
- Auth flow working
- Data persists across sessions

### Phase 3-4 (Community)
- 100 contributions
- 50% of visitors see a contribution
- Positive vote ratio on contributions

### Phase 5-6 (Growth)
- 1000 MAU
- 30% return within 7 days
- First business owner sign-up

### Phase 7 (Scale)
- 10,000 MAU
- Revenue covers hosting
- Native app launch

---

## Open Questions

1. **Moderation** - Community flagging + manual review? AI later?
2. **Spam prevention** - Rate limits? Account age requirements?
3. **Editorial layer** - Staff picks once content exists?
4. **International** - UK first, then expand?

---

## Technical Debt to Address

- [x] Proper PWA support
- [x] Error boundaries
- [x] Loading states consistency (LoadingState component created)
- [x] Accessibility audit (alt text, aria-labels, skip link)
- [x] Performance optimization (code splitting with React.lazy)
- [ ] E2E tests

---

*Last updated: January 2026*

---

## 🏗️ Architecture Overview

### Current Data Flow

```
User Location
     ↓
API Client (src/utils/apiClient.js)
     ↓
Multiple APIs in parallel:
├─ Overpass API (OSM places)
├─ OpenTripMap (attractions)
├─ Wikipedia (descriptions)
├─ Ticketmaster/Skiddle/Eventbrite (events)
     ↓
Normalize & Deduplicate
     ↓
Score & Filter (placeFilter.js)
     ↓
Display in SwipeCard/PlaceDetail
```

### Future Data Flow (with Supabase)

```
User Location
     ↓
API Client
     ↓
Place Data from APIs
     ↓
Enrich with Community Data:
├─ Contributions ("Why this place?")
├─ Vote counts
├─ Trending status
     ↓
Display with community context
```

### Key Files Quick Reference

| File | Purpose |
|------|---------|
| [src/main.jsx](../src/main.jsx) | App entry point, router setup |
| [src/App.jsx](../src/App.jsx) | Main app shell, navigation |
| [src/pages/Home.jsx](../src/pages/Home.jsx) | Discovery page with swipe cards |
| [src/pages/Events.jsx](../src/pages/Events.jsx) | Event listing and filtering |
| [src/components/SwipeCard.jsx](../src/components/SwipeCard.jsx) | The main card UI |
| [src/utils/apiClient.js](../src/utils/apiClient.js) | All API calls |
| [src/utils/placeFilter.js](../src/utils/placeFilter.js) | Scoring and filtering |
| [src/utils/categories.js](../src/utils/categories.js) | Category definitions |

### Environment Variables

**Local Development** (`.env.local`):
```
# MySQL Database
MYSQL_HOST=your-host.rds.amazonaws.com
MYSQL_PORT=3306
MYSQL_DATABASE=your_database
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password

# Auth
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
VITE_GOOGLE_CLIENT_ID=your_google_client_id (client-side)

# Optional cookie config (if using www + apex or cross-subdomain)
AUTH_COOKIE_DOMAIN=.yourdomain.com
AUTH_COOKIE_SAMESITE=None
```

**Vercel Production**:
```
# Event API keys (configure in Vercel dashboard)
TICKETMASTER_KEY=xxx
SKIDDLE_KEY=xxx
EVENTBRITE_TOKEN=xxx

# Database and auth (same as local)
MYSQL_HOST=xxx
MYSQL_PORT=3306
MYSQL_DATABASE=xxx
MYSQL_USER=xxx
MYSQL_PASSWORD=xxx
JWT_SECRET=xxx
GOOGLE_CLIENT_ID=xxx (optional)
VITE_GOOGLE_CLIENT_ID=xxx (client-side)
AUTH_COOKIE_DOMAIN=.yourdomain.com (optional)
AUTH_COOKIE_SAMESITE=None (optional)
```

---

## 🔧 Developer Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Testing PWA Locally

1. Build: `npm run build`
2. Preview: `npm run preview`
3. Open Chrome DevTools > Application > Manifest
4. Verify service worker registered

### Deploying to Vercel

1. Push to main branch
2. Vercel auto-deploys
3. Configure env vars in Vercel dashboard for event APIs

---

## 📝 Notes for Future Sessions

### If You're Picking This Up After a Break

1. Read this roadmap first
2. Check git log: `git log --oneline -10`
3. Check for uncommitted changes: `git status`
4. Read the change log above for recent decisions
5. Identify which phase we're in

### Decisions Already Made (Don't Revisit)

- **Community over editorial** — We don't have expertise to curate
- **MySQL for backend** — User's existing AWS RDS database (pivoted from Supabase due to free tier limits)
- **JWT auth with cookies** — httpOnly cookies for security, supports email/password + Google SSO
- **UK-wide scope** — No geographic restrictions initially
- **Pseudonymous accounts** — @username style, not real names
- **Free account to contribute** — Low friction for discovery, account for engagement

### Open Questions (Need User Input)

- Moderation strategy for contributions
- Spam prevention approach
- Staff picks / editorial layer once content exists
- International expansion timeline

---

## 🎯 Definition of Done

### For Phase 2 (Backend & Auth) ✅ COMPLETE

- [x] Database connection utility created (`api/lib/db.js`)
- [x] MySQL schema file ready (`database/schema.sql`)
- [x] Auth API routes created (register, login, logout, Google, me)
- [x] AuthContext and useAuth hook implemented
- [x] Auth UI (AuthModal) with login/signup forms
- [x] Run schema on MySQL server
- [x] Auth flow tested end-to-end
- [x] User profiles stored in database
- [x] Saved places migrated from localStorage to MySQL
- [x] Existing functionality still works for anonymous users

### For Phase 3 (Community Features) ✅ COMPLETE

- [x] "What made it special?" prompt after visit
- [x] Contributions stored in database
- [x] Contributions displayed on PlaceDetail page
- [x] Upvote/downvote working
- [x] User's own contributions visible in profile
- [x] Sign-in option added to onboarding flow

### For Phase 4 (Social) ✅ COMPLETE

- [x] Public user profile pages (`/user/:username`)
- [x] Follow other users with FollowButton component
- [x] Activity feed of followed users' contributions
- [x] "People Like You" recommendations based on similar tastes
- [x] Social stats on Profile page (followers, following, tips)
- [x] Activity page with feed and discover tabs

### For Phase 5 (Growth Features)

- [ ] Trending & Popular places section
- [ ] Social sharing (share cards to social media)
- [ ] Deep links to places/profiles
- [ ] Push notifications (new followers, upvotes)
- [ ] Offline maps

---

*This document is the source of truth for ROAM development. Update it as the project evolves.*
