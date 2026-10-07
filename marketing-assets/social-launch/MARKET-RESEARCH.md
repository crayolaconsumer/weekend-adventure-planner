# ROAM social launch brief (TikTok + Instagram Reels)

Researched 2026-10-04. Each claim has a source. **[UNVERIFIED]** means I could not confirm it from a primary source; the tag says what would settle it. Many "2026 guide" sites are SEO blogs. When a claim only comes from one of those, I name it as a secondary source.

---

## 1. Music licensing

### 1.1 The rules that matter

| Question | Answer | Source |
|---|---|---|
| TikTok business accounts: which in-app music can they use? | Only the Commercial Music Library (CML). TikTok's CML terms say Commercial Sounds are "the only sounds made available on TikTok for Commercial Uses." | https://www.tiktok.com/legal/page/global/commercial-music-library-user-terms/en |
| Can CML tracks be used off TikTok? | No. "Commercial Uses outside of TikTok are not permitted." So a CML track cannot be reused in the Instagram version. | same |
| Can a business account upload a video with its own music already mixed in? | Yes. At upload you accept TikTok's Music Usage Confirmation: either "(a) there is no copyright protected music in the video or (b) you have obtained and paid for all necessary licenses (including ... the musical compositions and the master recordings)". A CC BY licence covers both the composition and the recording for Kevin MacLeod tracks, because he owns both. | https://www.tiktok.com/legal/page/global/music-usage-confirmation/en |
| Meta Sound Collection: what does it allow? | Commercial or non-commercial use "in content you create, upload, and distribute on the Meta Company Products". It is not licensed for use outside Meta, so a Sound Collection track cannot be reused on TikTok. | https://www.facebook.com/sound/collection/terms |
| Instagram business accounts: which music can they use? | Business accounts only get the Sound Collection in the app. The wider library is licensed for personal, non-commercial use only. Meta's music guidelines say commercial or non-personal use of music needs appropriate licences. The primary page (facebook.com/legal/music_guidelines) did not render for me, so this is quoted through secondary sources. | https://usethirdchair.com/blog/instagram-reels-audio-library-what-brands-need-to-know , https://audiodrome.net/for-creators/meta-music-guidelines-facebook/ **[UNVERIFIED primary: open facebook.com/legal/music_guidelines in a browser]** |
| CC BY 4.0: is commercial use allowed? | Yes: "for any purpose, even commercially." Attribution must give credit, link the licence and say if changes were made, "in any reasonable manner". | https://creativecommons.org/licenses/by/4.0/ |
| Kevin MacLeod: exact attribution wording | `"<Title>" Kevin MacLeod (incompetech.com)` / `Licensed under Creative Commons: By Attribution 4.0` / `https://creativecommons.org/licenses/by/4.0/`. The credit must be placed so that "a person who wants to know where the music came from should have no difficulty in finding it." Incompetech says to buy its paid Standard Licence where you cannot show a credit, such as TV or radio ads. | https://incompetech.com/music/royalty-free/faq.html , https://incompetech.com/music/royalty-free/licenses/ |
| Pixabay Music | Free for commercial use with no attribution needed. You cannot redistribute a track on its own (it must sit inside a larger work). Pixabay's FAQ says its content can be used on social platforms. Some tracks are **registered with Content ID**: they can still be claimed, and Pixabay gives a licence certificate to dispute the claim. | https://pixabay.com/service/terms/ , https://pixabay.com/service/faq/ |
| YouTube Audio Library | YouTube only promises tracks are copyright-safe on YouTube and "can't give legal guidance ... off the platform." CC tracks need credit. Downloading needs a YouTube Studio login. **Do not use it for TikTok or IG.** | https://support.google.com/youtube/answer/3376882 |
| Free Music Archive | The licence varies per track. Use **CC BY or CC0 only**. CC BY-ND is out because CC 4.0 treats syncing music to video as an adaptation. CC BY-SA would push ShareAlike terms onto your video. BY-NC is out because ROAM is commercial. | https://freemusicarchive.org/License_Guide |

### 1.2 Business or creator/personal account?

**Recommendation: Business on both platforms.**

- ROAM is a company promoting its own app, so every post is commercial use whichever account type you pick. A creator account would show you the trending library, but that library is licensed for personal, non-commercial use (TikTok CML terms and Meta guidelines above). Using trending major-label audio on a brand account means unlicensed commercial use, and mutes or takedowns tend to hit at the worst time, when a post is taking off.
- A TikTok Business account gets a clickable website link in the bio straight away. Personal and creator accounts need 1,000+ followers first. Sources: https://www.outfy.com/blog/how-to-add-a-link-to-your-tiktok-bio/ , https://rocketlink.io/blog/tiktok-link-in-bio-requirements (secondary; consistent across several guides).
- What it costs you: no trending sounds. Secondary sources claim trending audio gives 3-5x reach and creator accounts get higher engagement (https://www.descript.com/blog/article/tiktok-business-vs-personal-creator-account , https://reflys.com/blogs/tiktok/business-vs-personal-tiktok-accounts). **[UNVERIFIED: these are vendor-blog figures with no published method.]** ROAM's format (on-screen text, real places, app UI) doesn't depend on trending sounds, so the cost is low.
- You can switch account type later in Settings, so the choice can be undone.

### 1.3 Muting and claim risk, and how to handle it

- Baked-in audio is posted as "original sound". Both platforms match audio fingerprints. Kevin MacLeod tracks carry ISRCs (for example, Happy Alley is ISRC USUAN1100482, taken from incompetech's own catalogue JSON at https://incompetech.com/music/royalty-free/pieces.json). That means they are distributed to streaming services and could be fingerprinted. I found **no reports** of incompetech tracks being muted on TikTok or IG. **[UNVERIFIED: settle it by posting the first reel and checking for an "audio unavailable" or copyright notice within an hour.]**
- Pixabay tracks marked "Content ID registered" carry higher claim risk. In the list below I prefer the incompetech tracks and the Pixabay track that is *not* registered.
- Simplest zero-risk option for each platform: add a CML track inside TikTok and a Sound Collection track inside Instagram. The trade-off is a different soundtrack per platform, and the audio is not baked into the master file.
- Keep a `music-licences.txt` with the track URL, licence URL, download date and the Pixabay certificate (where one exists), so you can dispute a claim quickly.

### 1.4 Tracks (free for commercial use, upbeat, about 100-130 BPM)

I checked every incompetech URL with a HEAD request on 2026-10-04: all return 200 and an MP3 of 2.5 to 14 MB. BPM and mood come from incompetech's own catalogue JSON. Licence: CC BY 4.0, credit as in 1.1.

| # | Track | BPM | Feel / instruments | Direct download |
|---|---|---|---|---|
| 1 | Happy Alley (Kevin MacLeod) | 112 | Bouncy, Bright, Grooving, Uplifting / guitar, bass, drums. Most "indie" of the set | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Happy%20Alley.mp3 |
| 2 | Inspired (Kevin MacLeod) | 120 | Bright, Uplifting / guitar, synths | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Inspired.mp3 |
| 3 | Life of Riley (Kevin MacLeod) | 102 | Bright, Relaxed, Uplifting / ukulele, glockenspiel, guitar | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Life%20of%20Riley.mp3 |
| 4 | Funin and Sunin (Kevin MacLeod) | 120 | Bouncy, Bright / organ, guitar, drums | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funin%20and%20Sunin.mp3 |
| 5 | Comin Round the Mountain (Kevin MacLeod) | 104 | Bouncy, Bright, Uplifting / guitar, drums, synths | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Comin%20Round%20the%20Mountain.mp3 |
| 6 | Funky Chunk (Kevin MacLeod) | 115 | Bright, Grooving, Uplifting / e-piano, horns | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funky%20Chunk.mp3 |
| 7 | Happy Bee - Surf (Kevin MacLeod) | 122 | Bouncy, Bright, Uplifting / surf guitar, organ | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Happy%20Bee%20-%20Surf.mp3 |
| 8 | Cheery Monday (Kevin MacLeod) | 102 | Bouncy, Bright / piano, glockenspiel | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cheery%20Monday.mp3 |
| 9 | Inspiring Trip (Acoustic Folk), PineAppleMusic, Pixabay | n/a (Pixabay shows no BPM) | Indie folk, bright guitars, bells, 2:51. Page shows **no Content ID registration** | https://pixabay.com/music/acoustic-group-inspiring-trip-acoustic-folk-159723/ (download button on the page; Pixabay returns 403 to scripts, so there is no direct file URL) |
| 10 | Discover the World, VasilYatsevich, Pixabay | n/a | Upbeat acoustic indie-pop, 1:57. **Content ID registered**: expect claims, keep the certificate | https://pixabay.com/music/indie-pop-discover-the-world-happy-upbeat-travel-music-145897/ |

Ready-to-paste caption credit, for example track 1:
```
Music: "Happy Alley" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0
https://creativecommons.org/licenses/by/4.0/
```
For a CC BY track, putting this in the caption is the safest choice. A link-in-bio credits page is arguably "reasonable" under CC BY's "any reasonable manner" wording, but it is less clearly findable. Ads: a TikTok Promote or Meta boost of a reel with a CC BY track is still covered by CC BY ("any purpose, even commercially") as long as the credit stays visible. Spark/Partnership-style ads that drop the caption should use a Pixabay track (no attribution needed) instead.

Other tracks considered and dropped: "Wallpaper" and "Carefree" are 92 and 96 BPM, below the range. "Upbeat Forever" is 164 BPM, too fast. "Monkeys Spinning Monkeys" and "Electrodoodle" are so heavily used on TikTok (incompetech's two most-played tracks there, per https://en.wikipedia.org/wiki/Kevin_MacLeod) that they sound like a meme rather than a brand.

---

## 2. What's working for days-out / local discovery content

### 2.1 Formats (ranked by fit for ROAM's assets)

1. **Numbered listicle with the town in the hook**, e.g. "5 things to do in Leeds that aren't the Corn Exchange". TikTok's own travel creative guide lists numbered listicles ("5 iconic spots in Rome") among its recommended hooks, alongside curiosity questions and benefit-first openers. It also says to use "lively, locally-themed music". https://ads.tiktok.com/business/creativecenter/quicktok/online/creative_tips_travel/pc/en
2. **Hidden gems / "you've lived in X and never been here"**. Secondary sources report that hyper-local, under-the-radar spots outperform big tourist cities ("3x engagement", **[UNVERIFIED stat]**). https://viryze.com/blog/tiktok-travel-trends-2026 , https://vidlo.video/blog/tiktok-content-strategy-for-travel-brands/
3. **Free / budget days out**. This is a proven niche: @travelcheapwithchloe (about 103K) and @beboldbebham ("free things to do in Birmingham") build on it. "Best free things to do in…" is listed as a searchable title pattern in the viryze source above.
4. **Swipe/rate POV using real app footage**: "POV: you swipe right on a pub you've walked past 100 times". This is ROAM's own format, because the swipe UI is the hook. I found no outside data on swipe-UI reels. Treat it as a test format, not a proven one.
5. **Itinerary-in-15-seconds**: "A perfect Saturday in York, planned in 10 seconds", showing the generated itinerary and walking times. It matches TikTok's advice to "combine multiple product selling points".

Green-screen talking head (founder in front of a place photo) works for spoken SEO (see 2.3). Use it once a week, because it costs a face and a voice.

### 2.2 Length, hook, text

- **Length 7-15 s is right for a new account.** Instagram only recommends reels of 3 minutes or less and advises "Keep your reels short" (https://creators.instagram.com/blog/tips-for-improving-your-reach). Mosseri says the ranking uses both completion % and absolute seconds watched (via https://futuresocial.beehiiv.com/p/instagram-revealed-the-ideal-reel-length). Short reels win on completion.
- **Hook in the first 1-3 s.** TikTok advises putting the proposition in the first 3 s, with the hook inside the first 6 s (https://ads.tiktok.com/help/article/creative-best-practices). Open on the most striking place shot with the town name already on screen at frame 1.
- **On-screen text:** TikTok reads overlays with OCR and transcribes speech for search (secondary: https://seosherpa.com/tiktok-seo/ , https://almcorp.com/blog/tiktok-seo/). Keep text inside the UI safe zone (TikTok creative best practices, above): clear of the bottom ~20% and the right-hand button rail.

### 2.3 Search, keywords, hashtags, captions

- **Put the search phrase in three places:** spoken (if there's a voice), on screen, and in the first line of the caption. Example: "Things to do in Bristol this weekend". Secondary: https://seosherpa.com/tiktok-seo/
- **Hashtags are capped at 5 on both platforms.** TikTok since Aug 2025: the app warns "Maximum 5 hashtags" (https://www.mediapost.com/publications/article/408371/tiktok-limits-hashtags-as-algorithms-become-more-s.html). Instagram since Dec 2025, counting caption and comments together (https://later.com/blog/ultimate-guide-to-using-instagram-hashtags/). Use 3-5 specific tags: `#thingstodoinbristol #bristol #daysout #hiddengems #ukdaysout`.
- **Same caption on both?** Yes, keep the same keyword first line and hashtags. Only the CTA differs: "Link in bio" (TikTok Business has a clickable bio link) versus "Link in bio / search ROAM on the App Store". No source says identical captions are penalised. Instagram's originality rules are about re-uploading *other people's* content and visible watermarks, not your own captions.

### 2.4 Cross-posting the same reel to both

- **Yes, post the same reel to both, but upload the clean master to each.** Never download from TikTok and re-upload: Instagram is "less likely to recommend ... content with noticeable watermarks" (https://creators.instagram.com/blog/tips-for-improving-your-reach , https://help.instagram.com/653964212890722). Export without a watermark from your editor, not CapCut's watermark export.
- If CC BY music is baked into the master, one file works on both platforms. If you use CML or Sound Collection, the audio has to be added inside each app.

### 2.5 Cadence, timing, first week

- **Cadence:** 1 post per day per platform. Secondary sources are consistent: new accounts should post 1-2 per day and avoid spam-like bursts in week 1 (https://360uniquizer.com/en/news/tiktok-posting-frequency-2026 , https://joinbrands.com/blog/how-often-to-post-on-tiktok/). The claim that TikTok "officially recommends 7-28 per week" is **[UNVERIFIED: I found no TikTok primary page]**.
- **UK times (Sprout Social, updated 31 Mar 2026; https://sproutsocial.com/insights/best-times-to-post-on-social-media-uk/):**
  - TikTok: Wed 3-11pm; Mon and Thu 4pm-12am. Worst day Saturday.
  - Instagram: Mon-Thu 5-9pm. Worst day Saturday.
  - Practical slot: **post at 6-7pm Mon-Thu**. For days-out content, add a **Thursday or Friday evening "this weekend in X"** post, since that's when people plan. Planning intent is my reasoning, not sourced data.
- **First week (14 posts total):**
  - Day 0: set up the profile fully before posting (section 4). Spend 20-30 min scrolling and engaging in the niche on each account (follow @secret.london and similar, comment on UK days-out videos) so the feed learns the account's interest. This warm-up is common practitioner advice, not a documented TikTok rule. **[UNVERIFIED]**
  - Days 1-7: 1 reel per day on each platform, the same reel, 6-7pm.
  - Mix: 4 town listicles (top towns from section 3), 1 hidden gem, 1 swipe POV, 1 itinerary demo.
  - By day 7, check 2-second hold / average watch % in analytics. Double down on whatever format beats the others.
- **Trial Reels** (Instagram's way to test on non-followers) are **not available to new accounts**. Secondary sources say you need 1,000 followers on a professional account (https://metricool.com/instagram-trial-reels/). So the first weeks are about learning from public posts.

### 2.6 Real accounts in the niche

Follower counts come from search-result snippets on 2026-10-04. TikTok blocks automated page fetches, so the live numbers are **[UNVERIFIED: open the profiles to confirm]**.

| Account | Size | What their content is |
|---|---|---|
| **@ukhiddengems** (TikTok) | ~947K followers, 14.9M likes | Little-known UK viewpoints and walks: "better than a postcard, overlooked by tourists". Landscape-first, minimal talking. https://www.tiktok.com/@ukhiddengems |
| **@secret.london** (TikTok, IG) | ~348K TikTok, ~3M IG | "LDN's best kept secrets": things to do, sweet treats, exhibitions, street interviews, walking tours. The benchmark for city listicles. https://www.tiktok.com/@secret.london , https://www.instagram.com/secret.london/ |
| **@travelcheapwithchloe** (TikTok) | ~103K | Free and budget UK attractions. |
| **@beboldbebham** (TikTok) | n/a | Birmingham "free things to do" listicles, using a #thingstodoinbirmingham keyword stack. https://www.tiktok.com/@beboldbebham/video/7321674363160317216 |
| **@abisguideto** (TikTok) | n/a | "MCR, days out + travel": one-city creator days out. |

Pattern across them: town or region name up front, a single place per shot, the creator's own footage, and a "free/hidden/locals-only" angle. None of them leads with an app. ROAM should lead with the place and reveal the app second.

---

## 3. Which towns first: "things to do in X" interest

Method: Google Trends, UK, past 12 months. I measured one 5-term comparison before Google showed a CAPTCHA, which I did not attempt to bypass. The relative average interest (Manchester = 100), read from the bar heights at roughly ±5:
**Manchester 100, Edinburgh ~90, Liverpool ~61, Birmingham ~54, Bristol ~49.**
For the rest I used VisitBritain official visitor volumes as a proxy:
- Domestic 2025 day visits: London 181.6m, Manchester 32.6m, Birmingham 25.5m, Liverpool 15.2m, Bristol 13.7m. Overnight trips also put Leeds in the top 5 (https://www.visitbritain.org/research-insights/england-domestic-tourism-regional-and-subregional-data).
- Inbound 2024: London, Edinburgh, Manchester, Birmingham, Liverpool, Glasgow, Oxford, Cambridge, Bristol, Brighton, Bath, Leeds, Cardiff, York (https://www.visitbritain.org/research-insights/inbound-visits-and-spend-trends-uk-town). Small samples outside London.

| Rank | Town | Evidence |
|---|---|---|
| 1 | London | #1 on every measure. Most competitive (Secret London, Time Out) |
| 2 | Manchester | Trends anchor 100; #2 domestic |
| 3 | Edinburgh | Trends ~90; #2 inbound |
| 4 | Liverpool | Trends ~61; #4 domestic |
| 5 | Birmingham | Trends ~54; #3 domestic |
| 6 | Bristol | Trends ~49; #5 day visits |
| 7 | Glasgow | #6 inbound **[proxy only]** |
| 8 | Leeds | Top-5 domestic overnight **[proxy only]** |
| 9 | York | Inbound top 15; classic day-out city **[proxy only]** |
| 10 | Brighton | Inbound #10 **[proxy only]** |
| 11 | Bath | Inbound top 11 **[proxy only]** |
| 12 | Oxford / Cambridge | Inbound #7 / #8 **[proxy only]** |

**Ranks 7-12 are not search data.** To settle them, open each of these 4-term comparisons by hand, with Manchester as the anchor:
- https://trends.google.com/trends/explore?date=today%2012-m&geo=GB&q=things%20to%20do%20in%20manchester,things%20to%20do%20in%20glasgow,things%20to%20do%20in%20leeds,things%20to%20do%20in%20york,things%20to%20do%20in%20london
- https://trends.google.com/trends/explore?date=today%2012-m&geo=GB&q=things%20to%20do%20in%20manchester,things%20to%20do%20in%20brighton,things%20to%20do%20in%20bath,things%20to%20do%20in%20oxford,things%20to%20do%20in%20cambridge

The cheapest better signal is ROAM's own data: which towns your users and town-page visitors are in. Check the town-page Search Console or analytics.

**Suggested order for the first reels:** Manchester, Liverpool, Birmingham, Edinburgh, Bristol, Leeds, then London. These are big search towns with less saturation than London. The order is my judgment from the data above, not a measured result.

---

## 4. Profile setup

| Item | Spec | Recommendation |
|---|---|---|
| Username | Must match on both. TikTok and IG handles are separate namespaces. | Try `@roam.uk`, `@goroam`, `@roamapp.uk`, `@go.roam`, in that order of preference. You have to check availability in the app yourself; I couldn't check it from here. Pick one handle and register it on **both** platforms, plus YouTube Shorts, the same day. |
| Display name | Searchable on both | "ROAM · Days out near you". Instagram name-field search picks up keywords. |
| Bio length | IG 150 chars (https://www.outfy.com/blog/instagram-character-limit/). TikTok 80 chars; some reports say a rollout to 160 is under way (https://howmanywords.app/blog/tiktok-character-limits) **[UNVERIFIED rollout]** | Formula: **what it is + who it's for + proof/hook + CTA**, within 80 chars for TikTok. |
| Bio, TikTok (≤80) | | `Swipe real places near you 🗺️ Pubs, parks, hidden gems. Free app ↓` (68 chars) |
| Bio, IG (≤150) | | `Find things to do near you 🇬🇧\nSwipe real pubs, parks & hidden gems → save → get a day-out plan\nFree on iPhone & Android ↓` |
| Link | TikTok Business: clickable from day 1. IG: up to 5 links, only the first shows (https://www.outfy.com/blog/instagram-character-limit/) | Link to a single smart page on go-roam.uk, e.g. `/get`, that sends iOS users to the App Store and Android users to Play. Add UTM tags per platform (`?utm_source=tiktok`) so installs can be traced. |
| Pinned posts | TikTok: pin up to 3 videos. IG: pin up to 3 posts/reels, and grid reorder launched June 2026 (https://www.inro.social/blog/reorder-instagram-grid) | Pin (1) the best "what ROAM does in 10 s" swipe demo, (2) the best-performing town listicle, (3) a "comment your town and we'll make yours next" post. Point 3 is cheap topic research and drives comments. Replace pins once week-1 data shows winners. |
| Highlights (IG only) | Optional; low impact for new accounts | 4 covers in brand colour with one icon each: **How it works · Towns · Hidden gems · Events**. Skip until there are stories to put in them. |
| Category | Business account category | "App page" or "Travel & transportation" on IG, depending on what the picker offers. |

---

## Verification log

| Claim | How verified |
|---|---|
| TikTok CML terms, Music Usage Confirmation wording | Fetched tiktok.com legal pages and quoted them |
| Meta Sound Collection terms | Fetched facebook.com/sound/collection/terms |
| Meta music guidelines "commercial or non-personal" | **Not verified**: the primary page rendered empty; quoted through two secondary sources |
| CC BY 4.0 terms; incompetech attribution text | Fetched creativecommons.org and incompetech FAQ |
| Incompetech download URLs, BPM, ISRC | Script: HEAD request on each URL (all 200, MP3 sizes 2.5-14 MB) plus a parse of incompetech's pieces.json |
| Pixabay licence, FAQ, Content ID status per track | Fetched pixabay.com terms, FAQ and each track page. The "not registered" status of Inspiring Trip was checked twice |
| Hashtag caps (TikTok 5, IG 5) | MediaPost (TikTok, dated 21 Aug 2025) and Later (IG). Not on an official Meta page **[UNVERIFIED primary for IG]** |
| UK posting times | Fetched Sprout Social UK page (updated 31 Mar 2026) |
| Instagram watermark/originality, ≤3 min | Fetched creators.instagram.com |
| TikTok link-in-bio rules, bio length, Trial Reels threshold | Secondary guides only **[UNVERIFIED]** |
| Account follower counts | Search snippets only **[UNVERIFIED live]** |
| Town ranking 1-6 | One Google Trends comparison read by eye (±5) plus VisitBritain official data |
| Town ranking 7-12 | VisitBritain visitor-volume proxy only **[UNVERIFIED as search interest]** |
| Kevin MacLeod tracks never muted on TikTok/IG | No evidence found either way **[UNVERIFIED: settle with the first post]** |
