# ROAM growth and retention brief

Date: Sunday 4 October 2026. Read-only research. No code changed.
Scope: what exists in the repo, what analogous apps did, what to advertise, which free channels to work, which retention levers to build, and how to measure it.

---

## 0. The one-paragraph version

ROAM has more product than it has users. The production DB holds **32 accounts, 27 of them created in May 2026, 1 created in the last 30 days, 5 signed-in users active in the last 7 days, 13 users with a push subscription and 6 with a stored location** (read-only aggregate query, 4 Oct 2026). Every re-engagement mechanic in the codebase (Friday nudge, Saturday nudge, Thursday events digest, visit reminders) only reaches **signed-in users who also opted in to push**, and nothing in the app asks a new signed-in user for push permission at a natural moment. So the retention machine exists but has almost nobody plugged into it. The order of work is: (1) make the funnel visible in PostHog (four missing events), (2) get push permission from more people at the first save, (3) personalise the Friday push and send it to active users too, (4) then pour acquisition in through short-form video built from town pages, local Facebook groups and Reddit, App Store featuring nominations, and venue QR posters. Lead the advertising with "Bored? One tap" and "Your Saturday, planned in a minute", with "rainy day" as the UK seasonal hook from now to March.

---

## 1. What actually exists (verified in code)

### 1.1 Surfaces
- Routes: `src/App.jsx:624-658`. Discover `/`, Events `/events`, Plan `/plan`, Wishlist `/wishlist`, Collections, Social `/social`, profiles `/user/:username`, visited map `/user/:username/map`, `/place/:id`, `/town` and `/town/:slug`, shared plan `/plan/share/:code`, Pricing, Get ROAM, Partners portal (`src/pages/Partners/`), Admin.
- Town pages: server-rendered by `api/town.js` + `api/lib/towns.js`; sitemap lists every UK town plus ~400 world cities (`api/sitemap.js:17-19`). Town pages carry store buttons, Apple smart banner, Play referrer `utm_campaign=<slug>` (`api/lib/towns.js` `playLink`) and an anonymous PostHog beacon (`town_page_view`, `store_click`).
- I'm Bored / Just Go: `src/components/JustGoModal.jsx`, weather-aware reasons in `src/utils/justGoReasons.js:39-46` ("Good indoor option while it rains").
- Independent-business detection: `src/utils/badges.js` (`KNOWN_CHAINS` list). This is a real differentiator vs Google Maps.
- Plan generator with real travel times: `src/pages/Plan.jsx:186` (`generate`), `:166` (`realTravel`), calendar export `src/components/plan/CalendarExport.jsx`, share modal `src/components/plan/ShareModal.jsx`.
- Social: follows, follow requests, friend activity (`api/places/friend-activity.js`, `src/hooks/useFriendActivity.js`, `src/components/FriendChips.jsx`), activity feed.
- Monetisation: ROAM+ (RevenueCat + Stripe), AdMob native cards (`src/components/AdCard.jsx`), promoted events with paid push boost (`api/cron/promoted-event-push.js`).

### 1.2 Retention and re-engagement mechanics

| Mechanic | Where | Who it reaches | State |
|---|---|---|---|
| Friday "got plans?" push, 16:00 UTC | `api/cron/weekend-plans-nudge.js` | Signed in, has push, account >3 days old, **inactive 72h+** | Live. Generic random copy (`NUDGES` array, line ~55). Active users excluded. |
| Saturday "fancy a roam?" push, 10:00 UTC | `api/cron/re-engagement-nudge.js` | Same audience as above | Live, generic. |
| Thursday "what's on near you" digest, 17:00 UTC | `api/cron/local-events-digest.js` | Signed in, push, has `user_locations` row | Live. DB has **6** location rows, so ≤6 recipients. |
| Planned visit reminder, 09:00 daily | `api/cron/visit-reminders.js` → `notifyPlannedVisit` | Users who planned a visit | Live. 5 plans total in DB. |
| Social pushes | `notifyNewFollower` (`api/social/index.js:604`), `notifyFollowRequestApproved` (`api/social/requests.js:185`), contribution upvote/removed (`api/contributions/index.js:575,592`) | Signed in + push | Live. |
| Daily streak | shown in `src/pages/Discover/DiscoverHeader.jsx:64`; badges `streak_3/7/30` in `src/pages/UnifiedProfile/badges.ts:47-50` | Everyone (local stats) | Live, but **daily** cadence is wrong for a weekend app (see 4.3). |
| Badges | `src/pages/UnifiedProfile/badges.ts`, `src/components/BadgeToastWatcher.jsx` | Signed in | Live. |
| Review prompt | `src/utils/reviewPrompt.js` (native, from 2nd *loved visit*, 120-day gap) | Native users who mark 2 visits as loved | Live, but the trigger is rare (see 4.3). |
| Share a place | `src/utils/shareCard.js:381` `sharePlaceLink`, used from `VisitedPrompt.jsx:636` and save moments | Everyone | Live. Link has **no UTM** (`/place/:id` only). |
| Share a plan, user map poster | `ShareModal.jsx`, `api/og/plan.tsx`, `api/og/user-map-poster` | Everyone | Live. |
| Welcome email | `api/lib/email.js:101` `sendWelcomeEmail` | Nobody | **Orphaned.** Defined, never called anywhere in `api/`. `RESEND_API_KEY` is set in `.env.production`. |
| Curated collections (Rainy Day Escapes, Date Night Ideas, Family Day Out, Hidden Gems) | `src/utils/collections.js:205-240` `CURATED_COLLECTIONS` | Nobody | **Orphaned.** Exported, never imported. |
| Referral / invite a friend | none | - | **Missing.** No referral, invite code or "invite friends" flow anywhere in `src/` or `api/`. |
| Seasonal content | none | - | **Missing.** Zero matches for halloween/christmas/bonfire/seasonal in `src/` and `api/`. |
| Weekly email digest | none | - | **Missing.** |
| Saved-list reminder ("you saved 12 places, 3 are open Saturday") | none | - | **Missing.** |
| Venue QR posters | none | - | **Missing.** No QR library, no poster route. Partners portal exists to hang it off. |
| Kids / dog-friendly filters | none in `src/utils/categories.ts` | - | **Missing.** Do not advertise to families or dog owners until these exist. |

### 1.3 Push permission: the bottleneck
- `src/components/Onboarding.jsx` comment says the push prompt "fires automatically the moment they sign in (see PushAuthSync in App.jsx)". **It does not.** `PushAuthSync` (`src/App.jsx:126-142`) returns early unless permission is already `granted` or the user previously opted in via settings (`localStorage roam_push_opted_in`). A fresh sign-up is never asked.
- The only contextual ask is `src/components/PlanVisitSheet.jsx:145-150` (planning a visit, signed in). The other path is the toggle in `src/pages/UnifiedProfile/NotificationsSection.jsx:131`.
- `api/push/subscribe.js:118-120` already accepts anonymous subscriptions (`user_id` NULL), but the client never asks anonymous users and every cron joins `push_subscriptions` to `users`, so an anonymous sub would never be sent anything. DB today: 86 subs, all tied to users (80 Android, 4 iOS, 2 web) across 13 users.

### 1.4 Analytics (PostHog)
- Client: `src/utils/analytics.js`. EU host, `capture_pageview: true`, autocapture off, session replay off. Key is set in `.env.production`. `identify()` is called on auth (`src/contexts/AuthContext.jsx:194`).
- Server-side: town pages beacon `town_page_view` and `store_click` (`api/lib/towns.js:500-512`).
- Events fired today: `onboarding_completed`, `onboarding_deferred`, `onboarding_resumed`, `signed-up` (email/google/apple), `place-saved`, `place-visited`, `place_share`, `store_click`, `review_prompt_requested`, `upgrade-clicked`, `upgrade-completed`, `offline-pack-downloaded`, `ad_card_*`.
- **Missing for the funnel:**
  1. No swipe event. "First swipe" is invisible. Hook: `src/components/CardStack.jsx:477` `handleSwipe`.
  2. No app-open on native foreground. Capacitor keeps the webview alive, so a user who returns on day 7 from the background fires no `$pageview`. D7 retention on native will be **undercounted**. Hook: `src/utils/nativeAppLifecycle.js:41` (`appStateChange`, `isActive`).
  3. No plan event. Hook: `src/pages/Plan.jsx:186` `generate`.
  4. No push permission result. Hook: `src/hooks/usePushNotifications.js:185` (native) and `:263` (web).
  5. No I'm Bored open. Hook: `src/pages/Discover.jsx` where `setShowJustGo(true)` is called.
- I could not read PostHog itself (no personal API key in the repo). Anonymous usage, real D1/D7 and install counts are **unverified**. Settle by opening PostHog EU and App Store Connect / Play Console.

### 1.5 Existing marketing material
- `marketing-assets/ROAM-marketing-playbook.md`: channel list and a 3-4 h/week cadence. Sound, but not ranked and not tied to measurement.
- `marketing-assets/ROAM-ad-copy.md`: Google App campaign headlines, descriptions, captions.
- `documents/marketing/LAUNCH_KIT.md` (Product Hunt, Show HN, store listing, OSM community, directories) and `documents/marketing/OUTREACH_DRAFTS.md` (BID pitch, venue cold email, student union pitch, local press pitch, weekly Facebook/Reddit shortlist template). Ready to use.
- `app-store-screenshots/STORE_COPY.md`: iOS name is just "ROAM", subtitle is the brand line, keywords use 99 of 100 characters.
- `docs/ROADMAP.md:789-792` already set the right bar: "1000 MAU, 30% return within 7 days".
- `documents/VERIFIED_AUDIT_FINDINGS.md` is a January security/code audit, not growth. Nothing in it blocks acquisition.

---

## 2. Competitors and analogs

| App | Early cheap acquisition | What they advertise | Where | Lesson for ROAM |
|---|---|---|---|---|
| **Secret London** (later part of Fever's Secret Media) | A Facebook group started 19 Jan 2010 hit 180,000 members by 8 Feb and 200,000 by 25 Feb 2010. Pure shareable "secret places" framing. [TechCrunch](https://techcrunch.com/2010/02/07/startup-to-launch-after-secret-london-facebook-group-amasses-180000/), [TechCrunch guest post](https://techcrunch.com/2010/02/16/guest-post-how-we-built-secret-london-in-a-weekend/), [Wikipedia](https://en.wikipedia.org/wiki/Secret_London) | "Secret", "hidden", "you didn't know about this" | Facebook, then site + social | "Hidden gems near you" is a proven UK share trigger. 2010 Facebook reach no longer exists, but the framing does. |
| **Fever** | Media-to-marketplace: a network of city channels (Secret NYC, Madrid Secreto, Secret London) drives demand, plus influencer programmes built into each experience. [Recreations](https://www.recreations.media/p/fever-fun-factory), [Wikipedia](https://en.wikipedia.org/wiki/Fever_(app)) | Specific experiences (Candlelight etc.), not "an app" | Instagram, TikTok, Facebook, own media | Sell the place, not the app. Each video is one concrete place or weekend; the app is the CTA. |
| **Time Out** | Editorial brand, ~4.5m UK social followers (search snippet, [InPublishing](https://www.inpublishing.co.uk/articles/time-out-london-reveals-ooh-campaign-24453); figure unverified on the page) | "Best things to do in X this weekend" lists | Social, SEO, OOH | Weekly "this weekend in [town]" is the format the market already expects. |
| **Day Out With The Kids** | SEO. Ranks #1 in UK for "days out with the kids", 8,000+ listings, paid listings for attractions. [ahrefstop](https://ahrefstop.com/websites/dayoutwiththekids.co.uk), [listing options](https://www.dayoutwiththekids.co.uk/listing-options) | Family days out, prices, opening times | Google | Families are owned by DOWTK and Hoop. ROAM should not lead with families without a kids filter. |
| **Hoop** | Launched London 2016, "over fifty thousand families in the first three months", Apple top 10 apps 2016, founders ex-VoucherCodes. [Medium](https://medium.com/@Hoop_App/the-new-must-have-app-for-london-parents-83945de191f), [TechCrunch](https://techcrunch.com/2017/09/27/hoop-app-for-millennial-parents-secures-2-4m-in-a-round-led-by-bgf-ventures/) | "Find things to do with your kids by age, time, distance" | Parent communities, Apple featuring | One sharp audience + one sharp filter beats a broad promise. Apple featuring mattered. |
| **AllTrails** | SEO trail pages convert mobile search traffic into app installs; CEO: "parlay all the mobile-first SEO traffic into incremental organic app installs". [RevenueCat](https://www.revenuecat.com/blog/growth/alltrails-product-channel), [SammySEO teardown](https://www.sammyseo.com/a-deep-dive-into-the-alltrails-com-seo-strategy/) | Trails near you, reviews, offline maps | Google | Direct model for ROAM town pages. Pages must keep getting fresh content (reviews, photos) to rank. |
| **Komoot** | Organic only from 2010; UGC (tips, photos, highlights) on OpenStreetMap data compounds. 45m registered users. [Komoot newsroom](https://newsroom.komoot.com/238612-komoot-breaks-the-40-million-mark-for-registered-users) | Plan your route, discover highlights | Community, SEO, partners | Same OSM base as ROAM. User tips/photos on places are the long-run moat and SEO fuel. |
| **Wanderlog** | SEO/content and collaborative trip invites that pull in new users (secondary source, [StartupFounderStories](https://startupfounderstories.com/stories/peter-harry-yu-wanderlog-trip-planner); unverified). YC W19. | Plan trips together | Google, Play search ("itinerary", "trip planner") | Shared plans should be an invite, not just a link. |
| **Atlas Obscura** | Community-submitted places + an email list of 1.7m. [Atlas Obscura press](https://press.atlasobscura.com/) | Curious, wondrous places | Email, SEO | Email list is an owned channel. ROAM has Resend wired and sends nothing. |
| **Google Maps Explore** | Default on every phone. Explore tab shows trending spots, events, filters such as good for kids, cheap, indoor/outdoor. [Google blog](https://blog.google/products-and-platforms/products/maps/now-available-new-ways-explore-google-maps/), [Help](https://support.google.com/maps/answer/10014587) | Everything nearby | Built in | ROAM cannot win on coverage. Win on speed to a decision (one tap, swipe), independents over chains, and the plan with walking times. |
| **Bumble BFF** | Campus ambassador programme (paid student reps hosting events). [How They Grow](https://www.howtheygrow.co/p/how-bumble-grows), [Global Dating Insights](https://www.globaldatinginsights.com/news/student-ambassadors-vital-to-bumbles-campus-strategy/) | Make friends | Campuses | Students in a new city are a dense, reachable "new to town" audience. Use SU and halls, not paid reps. |

---

## 3. What ROAM should advertise

ROAM's honest advantages, from the code: one-tap decision (I'm Bored), swipe to shortlist, a walking-time day plan, independents flagged over chains, weather-aware reasons, works in any town worldwide, free.

### 3.1 Five angles, ranked

| # | Angle (headline) | Audience | Lead feature | Proof shot for video |
|---|---|---|---|---|
| 1 | **"Bored? One tap."** | 20-35 couples and friends, students | I'm Bored / Just Go | Tap the button, three real places near you, walking time. |
| 2 | **"Your Saturday, planned in a minute."** | Couples, new-to-town, visitors | Plan generator with walking times, share plan | Swipe 5 places, hit plan, show the timed route, send to partner. |
| 3 | **"Hidden gems, not chains."** | Locals bored of the same places | Independent badge, Hidden Gems | "3 places in [town] you've walked past and never been in." |
| 4 | **"Rainy day? Sorted."** (Oct to Mar) | Everyone in the UK, couples, parents | Weather-aware Just Go reasons, Rainy Day Escapes collection (needs un-orphaning) | Rain on the window, open ROAM, indoor picks. |
| 5 | **"New in town?"** | Students (freshers, Jan intake), movers, remote workers | Town pages, swipe deck, follow friends | "Moved to [city] last month. Here's how I found my spots." |

Do not lead with:
- **Families with kids**: no kids filter or age info; DOWTK and Hoop own it. Becomes viable once `curated_family` is surfaced and a kids-friendly filter exists (OSM `leisure=playground`, zoos, farms are already parsed in `src/utils/googlePlaces.js:35-45`).
- **Dog owners**: no dog-friendly data surfaced. Do not promise it.
- **"Tinder for days out"**: fine for r/SideProject and press hooks, weak for consumers (dating connotation; swiping is a mechanic, not a benefit).

### 3.2 Store listing (ASO) fixes, character counts checked by script
- iOS name is "ROAM" (4 chars). The name is the heaviest-weighted keyword field. Change to **"ROAM: Things to Do Near Me" (26)**.
- Subtitle "Stop scrolling. Start roaming." (30) has no searchable words. Change to **"Days out, plans & hidden gems" (29)**. Keep the brand line in screenshots.
- Keywords: Apple already indexes title and subtitle words, so stop repeating "things to do, near me, days out". Suggested: `date,ideas,rainy,day,walks,whats on,weekend,bored,local,activities,explore,events,cafe,pub,trip` **(95)**.
- Screenshot 1 should be the I'm Bored result, not the brand line.
- Validate with App Store Connect "App Analytics > Sources > App Store Search" after 2 weeks.

---

## 4. Acquisition channels, ranked by expected installs per founder-hour

Numbers in this table are my estimates for a solo UK founder at ROAM's stage, not measured. They are there so you can rank and later replace with real numbers from section 6.

| Rank | Channel | Founder time | Expected installs | Why this rank | Status |
|---|---|---|---|---|---|
| 1 | **ASO fixes** (3.2) | 1-2 h once | Small but permanent lift on all search traffic | Every other channel lands on the store page. | Ready, copy above. |
| 2 | **Apple featuring nomination** | 1 h per nomination | 0 or a lot. Hoop's 2016 Apple top-10 pick was a launch driver. | Free, low effort, high variance. Min lead time **3 weeks** per [Apple](https://developer.apple.com/help/app-store-connect/manage-featuring-nominations/nominate-your-app-for-featuring/). Types: App Launch, App Enhancements, New Content. Attach an In-App Event. | Not done (assumed; check App Store Connect > Featuring > Nominations). |
| 3 | **Google Play featuring interest form** | 1 h | Same variance | Google says an app must be "great quality to be eligible for featuring"; submission via "Submit Your Interest Here" form on [Play's featuring guide](https://google.play/business/guides/featuring/). Third-party guides say new apps (≤4 months) only, rating ≥3.0 ([ASOMobile](https://asomobile.net/en/blog/how-to-get-your-app-featured-on-the-google-play/), unverified on Google's page). | Not done. |
| 4 | **Local Facebook groups, weekly shortlist** | 1-2 h/week | Best per-hour for UK local. Group posts are where UK days-out talk happens. | Template exists (`OUTREACH_DRAFTS.md` §5). Give five real places with no link in the body, app in a comment or on request. | Template ready. |
| 5 | **Reddit, value-first** (r/[city], r/AskUK threads; one r/SideProject launch post) | 1 h/week + 2 h once | Spiky. One good r/SideProject post can bring hundreds. | Many subs ban self-promo; read each sub's rules first. I could not fetch r/CasualUK rules (Reddit blocked the request): **unverified**. | Ready. |
| 6 | **Short-form video (TikTok, Reels, Shorts)** | 3-5 h/week for 3-5 posts | Volume game: most posts get little, a few carry the month. | Slideshow/carousel "5 things to do in [town] this weekend" is cheap to make and holds attention ([Stormy](https://stormy.ai/blog/tiktok-organic-strategy-viral-app-growth), [Playkit](https://playkit.substack.com/p/couple-joy-faceless-slideshow-growth)). Fever's lesson: sell a place, not an app. | Promo video exists; no repeatable format yet. |
| 7 | **Town page SEO** | ~0 h/week once set up | Slow (months) but compounding, AllTrails model. | Already built and in the sitemap. Remaining: Search Console coverage check, internal links from social posts, fresh UGC on pages. | Built. |
| 8 | **Venue QR posters via Partners** | 4-6 h build, then 1 h per 5 venues walked in | Each poster is a permanent install point at the moment of intent. | Venues want footfall; ROAM gives a free listing link. Needs a QR route (none exists). | Missing. |
| 9 | **Local press / BBC local radio** | 2-3 h per pitch round | Spike of tens to low hundreds per hit. | Pitch exists (`OUTREACH_DRAFTS.md` §4). Hook: "Local founder builds free app to beat rainy-weekend boredom". | Draft ready. |
| 10 | **Student unions, halls, "new to town"** | 2 h of emails | Dense audience. | Freshers is past; aim for reading week and January welcome-back. Draft ready (`OUTREACH_DRAFTS.md` §3). | Draft ready. |
| 11 | **Micro-creator gifting** (ROAM+ free year to 5k-50k UK "days out" creators) | 2 h/week outreach | Low per creator, occasional hit. | Free to give; costs DMs. | Not started. |
| 12 | **Referral loop** | 1-2 days build | Multiplies every other channel once users exist. | Pointless before there are users to refer; build after week 2. | Missing. |
| 13 | **Product Hunt / Show HN** | 4-6 h | Mostly non-UK tech people who will not use a UK days-out app weekly. Worth it for backlinks only. | Low fit. | Kit ready. |

### 4.1 First 30 days (Mon 5 Oct to Wed 4 Nov 2026)

Key dates checked by script: clocks go back **Sun 25 Oct**, Halloween **Sat 31 Oct**, Bonfire Night **Thu 5 Nov**. October half-term in England is mostly the week of 26 Oct (varies by council, unverified per area).

**Week 1 (5-11 Oct): measure and fix the store page**
- Ship the five analytics events in 1.4 and UTM on share links (section 6). Build the PostHog funnel and retention insights. Nothing else is worth judging without this.
- ASO changes from 3.2.
- Submit Apple nominations now: (a) "App Enhancements: worldwide town pages and rainy-day picks" for late Oct; (b) "New Content: Christmas markets and winter days out near you" for mid to late Nov, with an In-App Event. Submit the Google Play interest form.
- Open Instagram + TikTok. Post 3 slideshows: "5 things to do in [your town] this weekend", "3 rainy day ideas in [town]", "hidden gems in [town] that aren't chains".
- First Facebook group shortlist in your own area (5 groups).

**Week 2 (12-18 Oct): retention plumbing**
- Push ask at first save for signed-in users (4.3 #1).
- Friday nudge: include active users, use a saved place name (4.3 #2).
- Wire `sendWelcomeEmail` into sign-up.
- Content: 4 posts, one per format: slideshow, screen recording of I'm Bored, "planned my Saturday in 60 seconds", a Reddit-style "what's actually good in [town]" text post.
- r/SideProject launch post (Tue/Wed morning UK).

**Week 3 (19-25 Oct): seasonal + local**
- Halloween / half-term content: "pumpkin patches and spooky walks near [town]" (Events tab covers ticketed ones).
- "Clocks go back: 5 cosy indoor spots for dark evenings" for 25 Oct.
- Walk 5 local venues with a printed QR (even a manual one made from a free generator pointing to `/place/<id>?utm_source=qr&utm_medium=poster&utm_campaign=<venue>`) to test before building the Partners poster feature.
- Local press pitch to your Reach title and BBC local radio with the rainy-day angle.

**Week 4 (26 Oct-4 Nov): read the numbers, double down**
- Review: which posts drove `town_page_view` and `store_click`, which share links were opened, D1 and D7 for the first cohort.
- Keep the two channels with the best installs per hour; drop the rest.
- Bonfire Night content for 5 Nov. Start Christmas market content for Week 5+ to line up with the Apple nomination.
- Build the referral/invite card if share-driven installs show up at all.

Weekly cadence after that (fits ~4-5 h): Mon pick 3 towns and draft slideshows from their town pages; Wed post 2 videos; Thu morning Facebook/Reddit "this weekend in [town]" shortlist (lands before the 17:00 Thursday digest and 16:00 Friday push); Fri 1 video; Sun 15 min review in PostHog.

---

## 5. Retention

### 5.1 Benchmarks (secondary sources, treat as ranges)
- Cross-industry median: D1 ~25%, D7 ~8%, D30 ~4%; strong apps D1 30-40%, D7 10-15%, D30 5-8%. [UXCam](https://uxcam.com/blog/mobile-app-retention-benchmarks/), citing AppsFlyer 2025 and Adjust 2026.
- Lifestyle: D1 25%, D7 13.1%, D30 5.9%. Travel: D1 ~16%, D7 ~7.6%, D30 3-5%. [GetStream](https://getstream.io/blog/app-retention-guide/), [Engagelab](https://www.engagelab.com/blog/increase-app-retention), [Sendbird](https://sendbird.com/blog/app-retention-benchmarks-broken-down-by-industry). Primary data behind these figures not checked: **unverified**.
- Push: Airship reports users receiving weekly push had far higher retention than those receiving none ([Airship benchmark PDF](https://grow.urbanairship.com/rs/313-QPJ-195/images/WP_App_Retention_Rates_Benchmarks.pdf)). This is correlation (engaged users opt in), not proof of cause. 46% of users opt out after 2-5 pushes a week ([MobiLoud](https://www.mobiloud.com/blog/push-notification-statistics/)). Opt-in medians 2025: iOS ~49%, Android ~53% ([Airship 2025 benchmarks](https://growth.airship.com/rs/313-QPJ-195/images/Airship-2025-Push-Notification-Benchmarks-EN.pdf?version=0)).

**ROAM targets** (my judgement, weekend app sits between lifestyle and travel): D1 ≥ 25%, D7 ≥ 12%, D30 ≥ 6%. Because use is weekly, also track **weekly retention W1-W4** with a goal of ≥ 15% of a cohort active in week 4. The roadmap's "30% return within 7 days" (`docs/ROADMAP.md:791`) is a stretch target, keep it.

### 5.2 What works for weekend-planning apps
The habit is weekly, not daily. Levers that fit that rhythm:
1. A Thursday/Friday "your weekend" moment that is personal (your saved places, the weather, what's on).
2. Saved-list reminders: a save is an intention; remind on Friday, not at random.
3. Events near you, weekly digest, not per event.
4. Friend activity: "Sam saved 3 places in Bath" is the strongest reason to open a social app.
5. Weekly, not daily, streaks ("weekends roamed").
6. Seasonal collections: rainy day, clocks back, Halloween, Bonfire Night, Christmas markets, spring walks.
7. Email for people who decline push.

### 5.3 Ranked retention work, with the exact hook

| # | Change | Impact | Effort | Hook |
|---|---|---|---|---|
| 1 | **Ask for push at the first save** (signed in). One soft pre-prompt sheet ("Want a nudge on Friday with your saved places?") then the OS dialog. Also fix the false comment in Onboarding. | High: every other lever depends on it. 13 users have push today. | Small | `src/hooks/useSavedPlaces.js:106` (where `place-saved` fires) or `CardStack.jsx:477` on first right-swipe; reuse `usePushNotifications().subscribe`; mirror the gate in `PlanVisitSheet.jsx:145`. |
| 2 | **Friday push to all opted-in users, personalised.** Drop the 72h-inactive filter for this one job (keep it for Saturday), and use a saved place: "You saved The Old Bookshop. Saturday looks dry." Fall back to generic copy. | High | Small | `api/cron/weekend-plans-nudge.js`: the `WHERE us.last_activity_at < ...72 HOUR` clause and `pickNudge()`. Join `saved_places`; weather from `api/weather.js`. |
| 3 | **Anonymous native push.** Ask anonymous native users at first save too; store a coarse location with the sub; let the Friday and Thursday crons include `user_id IS NULL` subs. | High (most users are probably anonymous; confirm in PostHog) | Medium | Client: `src/hooks/usePushNotifications.js`. Server already accepts it: `api/push/subscribe.js:118-120`. Crons: the `INNER JOIN push_subscriptions ... users` queries. Needs saved places for anon users to be readable server-side or personalisation falls back to location only. |
| 4 | **Wire the welcome email, then a Thursday weekly email digest** ("your weekend: 3 saved places open, 2 events, the weather"). | Medium | Small (welcome) / Medium (digest) | Call `sendWelcomeEmail` (`api/lib/email.js:101`) from the register and new-OAuth paths in `api/auth/index.js`. Digest as a new cron next to `api/cron/local-events-digest.js`, respecting `notification_preferences.weekly_digest`. Resend key is set in prod. |
| 5 | **Surface the orphaned curated collections** as entry chips on Discover and town pages (Rainy Day Escapes, Date Night, Hidden Gems; Family only once a kids filter exists), then add seasonal ones. | Medium (also feeds the ad angles) | Small | `src/utils/collections.js:205` `CURATED_COLLECTIONS`, render in `src/pages/Discover.jsx` or `src/pages/Collections.jsx`. |
| 6 | **Weekly streak** ("3 weekends in a row") instead of the daily streak in the header. | Medium | Small | `src/hooks/useUserStats.js` (`currentStreak`), `DiscoverHeader.jsx:64`, badges in `badges.ts:47-50`. |
| 7 | **Lower the review prompt bar**: also ask after the 5th save on the 2nd+ day of use, not only after 2 loved visits. Ratings drive store conversion. | Medium (acquisition via store rating) | Small | `src/utils/reviewPrompt.js` (`MIN_LOVED`, add a save-count path called from `useSavedPlaces.js`). |
| 8 | **Invite a friend** card in Social and after sharing a plan: link to `/user/<username>` with "follow me on ROAM", UTM tagged. | Medium, grows with base | Medium | `src/pages/SocialHub.jsx`, `src/components/plan/ShareModal.jsx`. |
| 9 | **Friend activity push** ("Sam saved 3 places near you") weekly, batched. | Medium once a graph exists (55 follows today) | Medium | `api/places/friend-activity.js` data + a weekly cron. |
| 10 | **Venue QR posters** in the Partners portal. | Acquisition more than retention | Medium | `src/pages/Partners/PartnerDashboard.jsx`; poster render could reuse `api/og/*` (Satori). Needs a QR encoder (small library or vendored). |

---

## 6. Measurement

### 6.1 Minimum KPI set (check every Sunday, 15 minutes)
1. **Installs per week by source**: App Store Connect (Sources), Play Console (acquisition reports, Play referrer `utm_campaign` already set per town).
2. **Activation rate**: % of new users who save ≥1 place in their first session. This is the "aha".
3. **D1, D7, D30 retention** and **weekly retention W1-W4** (PostHog Retention insight).
4. **Push opt-in rate** among new users (needs the `push_permission` event).
5. **Weekly roamers** (north star): users who saved, planned or marked visited in the week. Today: unknown; the DB view (signed-in only) says 5 WAU.
6. **Share rate and share installs**: `place_share` per weekly active user; installs/visits from `utm_source=share`.
7. **Town page funnel**: `town_page_view` → `store_click` CTR per town.

### 6.2 The funnel in PostHog
`install/first open ($pageview, first time)` → `onboarding_completed` → `card_swiped` (missing) → `place-saved` → return day 7 (`app_opened` or `$pageview`).

What to add so it works (each is a one-line `track()` call except UTM):
- `card_swiped` `{ direction, first }` in `src/components/CardStack.jsx:477`.
- `app_opened` `{ platform, source: 'foreground' }` in `src/utils/nativeAppLifecycle.js:41` when `isActive`. Without it, native D7 is undercounted.
- `plan_generated` `{ stops, mode }` in `src/pages/Plan.jsx:186`.
- `push_permission` `{ result, surface }` in `src/hooks/usePushNotifications.js:185` and `:263`.
- `just_go_opened` in `src/pages/Discover.jsx` where `setShowJustGo(true)` is called.
- UTM on outbound links: `src/utils/shareCard.js:386` → `/place/<id>?utm_source=share&utm_medium=<source>`; same for plan share and user map. PostHog stores first-touch UTM on the person automatically for web landings.
- iOS install attribution: use App Store Connect campaign links (`pt`/`ct` parameters) on every link you post (town pages, bio links), so App Analytics splits installs by campaign.

PostHog free tier covers 1M events/month with funnels, retention and paths included ([PostHog pricing](https://posthog.com/product-analytics/pricing)). At current volume this costs nothing.

Insights to create (once events land):
1. Funnel: `onboarding_completed` → `card_swiped` → `place-saved`, 1-day window, breakdown by `$os`.
2. Retention: start `onboarding_completed`, return `app_opened OR $pageview`, daily and weekly.
3. Trend: `place_share` and `store_click` by `source`.
4. Trend: `town_page_view` by `town`, plus `store_click` ratio.

---

## 7. Verification log

| Claim | How checked | Result |
|---|---|---|
| User, push, save, plan, follow, location counts | Read-only aggregate SQL on prod `plesk_go-roam` (script in scratchpad `stats.mjs`) | 32 users; 1 created last 30 d; 5 active 7 d; 13 users / 86 push subs, 0 anonymous; 203 saves / 17 users; 1,435 swipes / 19 users; 55 follows; 5 plans; 6 locations. |
| Push not asked at sign-in | Read `src/App.jsx:126-142` | Confirmed: requires prior grant or opt-in flag. |
| `sendWelcomeEmail` unused | grep across `api/` and `src/` | Confirmed: no caller. |
| `CURATED_COLLECTIONS` unused | grep across `src/` | Confirmed: only `COLLECTION_EMOJIS` is imported. |
| No referral/seasonal/QR code | grep `referral|invite_code|inviteCode`, `halloween|christmas|bonfire|seasonal`, `qr` | Zero matches. |
| No swipe / foreground analytics | grep `track(` call sites; read `nativeAppLifecycle.js:41` | Confirmed. |
| Dates (25 Oct Sun, 31 Oct Sat, 5 Nov Thu) | `date` / `cal` | Confirmed. |
| ASO character counts | Python `len()` | 26, 29, 95 as stated. |
| Apple nomination lead time | Fetched Apple help page | "minimum lead time of 3 weeks". Some third-party guides say 2 weeks; Apple's page wins. |
| Google Play featuring form | Fetched Play featuring guide | Interest form exists; no eligibility window stated on Google's page. |
| Secret London growth | TechCrunch 2010 articles (search results) | 180k by 8 Feb, 200k by 25 Feb 2010. |
| Retention benchmarks | Search snippets + UXCam fetch | Category figures from secondary blogs: **unverified** against primary AppsFlyer/Adjust reports. |
| Real anonymous usage, installs, D7 | Not accessible (no PostHog API key, no store console access) | **Unverified.** Settle in PostHog EU and the store consoles. |
| r/CasualUK self-promo rules | Reddit JSON blocked | **Unverified.** Read the sidebar before posting. |
| Installs-per-hour estimates (section 4) | Judgement | **Unverified** by design; replace with week-4 numbers. |
