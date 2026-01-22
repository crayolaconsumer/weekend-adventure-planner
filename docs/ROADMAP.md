# ROAM Product Roadmap

> **Vision**: A community-driven local discovery platform where users tell each other why places matter.

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

## Phase 1: Foundation (Current)

### PWA Support
Make it installable on phones without app stores.

- [x] Basic app structure
- [ ] manifest.json with app metadata
- [ ] Service worker for offline caching
- [ ] "Add to Home Screen" support

### Files
- `/public/manifest.json` - App manifest
- `/public/sw.js` - Service worker
- `/index.html` - Link manifest, register SW

---

## Phase 2: Backend & Auth (Week 1-2)

### Supabase Integration
Replace localStorage with real database.

**Why Supabase:**
- Postgres database
- Built-in auth (email, social, magic link)
- Row-level security
- Realtime subscriptions
- Generous free tier

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

## Phase 3: Community Features (Week 2-4)

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

## Phase 4: Social (Week 4-6)

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

- [ ] Proper PWA support
- [ ] Error boundaries
- [ ] Loading states consistency
- [ ] Accessibility audit
- [ ] Performance optimization (code splitting)
- [ ] E2E tests

---

*Last updated: January 2026*
