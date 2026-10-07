# ROAM social launch pack (TikTok + Instagram)

Built 4 Oct 2026. Everything here is ready to post. Start with section 1, then post one reel a day from section 3.

| Folder / file | What it is |
|---|---|
| `reels/` | 14 finished reels (York, Edinburgh, Oxford, Bath, Liverpool, Manchester, London, Glasgow, Brighton, Bristol, Cambridge, Leeds, Birmingham, Newcastle), 11-16.5s, 1080x1920, 60fps, H.264 + AAC at -14 LUFS, music baked in |
| `reels/no-music/` | The same 14 with no audio, for adding a trending sound inside TikTok/Instagram |
| `carousels/<reel>/` | 14 Instagram carousels (1080x1350, 5-6 slides), one per reel. Also work as TikTok photo posts |
| `profile/` | Profile picture (1080x1080) and 4 Instagram highlight covers |
| `captions.md` | Paste-ready caption for every reel: search phrase first, places, CTA, music credit, photo credits, 5 hashtags |
| `MARKET-RESEARCH.md` | Music licensing, formats, cadence, UK posting times, which towns, profile setup. Sourced |
| `GROWTH-STRATEGY.md` | What to advertise, channels ranked, retention fixes with file:line hooks, KPIs, 30-day plan. Sourced, with prod DB numbers |
| `FACT-CHECK.md` | Every on-screen claim checked against Wikipedia / venue sites |
| `studio/` | The generator. A new town reel in about 15 minutes including photo picking (see `studio/README.md`) |

---

## 1. Account setup (do this before the first post)

1. **Account type: Business on both.** Creator/personal music libraries are licensed for personal use only, and ROAM promoting itself is commercial. TikTok Business also gives a clickable bio link from day one.
2. **Same handle on both, same day.** Try in order: `@roam.uk`, `@goroam`, `@roamapp.uk`, `@go.roam`. (Availability not checked; do it in the apps.)
3. **Display name:** `ROAM · Days out near you` (Instagram searches the name field).
4. **Bio**
   - TikTok (80 max): `Swipe real places near you 🗺️ Pubs, parks, hidden gems. Free app ↓`
   - Instagram (150 max):
     ```
     Find things to do near you 🇬🇧
     Swipe real pubs, parks & hidden gems → save → get a day-out plan
     Free on iPhone & Android ↓
     ```
5. **Bio link** (already live, shows both store buttons):
   - TikTok: `https://www.go-roam.uk/get-roam?utm_source=tiktok&utm_medium=social&utm_campaign=bio`
   - Instagram: `https://www.go-roam.uk/get-roam?utm_source=instagram&utm_medium=social&utm_campaign=bio`
6. **Profile picture:** `profile/avatar.png`. Highlight covers (`profile/highlight-*.png`) once you have stories.
7. **Warm-up:** 20 minutes on each account following and commenting on UK days-out creators (@ukhiddengems, @secret.london, @beboldbebham, @abisguideto) so the feed learns the niche.

## 2. Posting rules

- **Upload the file from `reels/` to each platform separately.** Never download from TikTok and re-post to Instagram; Instagram demotes watermarked reels.
- **Same caption on both.** Copy the block from `captions.md`. Keep the 🎵 line: it is the CC BY licence condition for the music.
- **Time:** 6-7pm. Saturday is the weakest day on both platforms (Sprout Social UK, Mar 2026).
- **Want a trending sound instead?** Use the `reels/no-music/` file and add the sound in-app (Business accounts: TikTok Commercial Music Library / Meta Sound Collection only). Delete the 🎵 line from the caption when you do.
- **Check the first post within an hour** for "audio unavailable" or a copyright notice. No reports found of these Kevin MacLeod tracks being muted, but it's unverified.

## 3. First two weeks: one reel a day, carousels as a second post

| Date | Reel | Carousel (IG + TikTok photo post) |
|---|---|---|
| Tue 06 Oct | `york-things` (**pin it**) | |
| Wed 07 Oct | `manchester-things` | |
| Thu 08 Oct | `edinburgh-things` | `york-things` |
| Fri 09 Oct | `london-things` | |
| Sat 10 Oct | `liverpool-things` | |
| Sun 11 Oct | `oxford-things` | `manchester-things` |
| Mon 12 Oct | `glasgow-things` | |
| Tue 13 Oct | `bath-things` | |
| Wed 14 Oct | `brighton-things` | `edinburgh-things` |
| Thu 15 Oct | `bristol-things` | `oxford-things` |
| Fri 16 Oct | `leeds-things` | |
| Sat 17 Oct | `cambridge-things` | |
| Sun 18 Oct | `birmingham-things` | `bath-things` |
| Mon 19 Oct | `newcastle-things` | |
| Tue 20 Oct onwards | new towns from the studio | the remaining carousels, two a week |

Then one new town a day from the studio. Next towns by search demand: Glasgow's neighbours (Stirling), Cardiff (needs better park and bay photos), Nottingham, Sheffield, Leicester, Norwich, Exeter.

After day 7, compare the 2-second hold and average watch % per reel and make more of the winner. **The comment loop:** end a pinned post with "Comment your town and we'll make yours next", then reply with the video.

## 4. The reels, and what didn't make the cut

| Reel | Length | Music | Hook photo, then places |
|---|---|---|---|
| `york-things` | 16.5s | Life of Riley | The Shambles → National Railway Museum (Mallard), Clifford's Tower, The Kings Arms, York Minster ("Fine, we had to.") |
| `edinburgh-things` | 14.1s | Inspired | Calton Hill at golden hour → Castle, National Museum of Scotland, Camera Obscura, Holyrood Park |
| `oxford-things` | 12.1s | Funky Chunk | Radcliffe Camera → Sheldonian, Ashmolean, Botanic Garden |
| `bath-things` | 11.4s | Happy Bee - Surf | Prior Park → No. 1 Royal Crescent, Holburne, Sally Lunn's |
| `liverpool-things` | 14.7s | Funky Chunk | Royal Liver Building → Royal Albert Dock, The Beatles Story, World Museum, Liverpool Cathedral |
| `manchester-things` | 13.9s | Happy Bee - Surf | Skyline at sunset → Science and Industry Museum, Art Gallery, National Football Museum, Heaton Park |
| `london-things` | 11.6s | Inspired | Tower Bridge at dusk → British Museum, Tate Modern, Natural History Museum |
| `glasgow-things` | 15.6s | Funin and Sunin | The Clyde Arc at night → Kelvingrove, Riverside Museum, Glasgow Cathedral, Botanic Gardens |
| `brighton-things` | 11.4s | Happy Bee - Surf | Seafront → Brighton Pier, Royal Pavilion, Brighton Museum |
| `bristol-things` | 15.6s | Funin and Sunin | Colourful harbourside → Clifton Suspension Bridge, SS Great Britain, Bristol Museum & Art Gallery, We The Curious |
| `cambridge-things` | 11.6s | Inspired | Punting on the Cam → King's College Chapel, Fitzwilliam Museum, Botanic Garden |
| `leeds-things` | 14.7s | Funky Chunk | Kirkstall Abbey at sunset → Kirkstall Abbey, Royal Armouries, Leeds Art Gallery, Roundhay Park |
| `birmingham-things` | 11.4s | Happy Bee - Surf | Gas Street Basin → Museum & Art Gallery (Staffordshire Hoard), Cadbury World, Back to Backs |
| `newcastle-things` | 13.6s | Life of Riley | Tyne Bridge → Angel of the North (Gateshead), Great North Museum, Laing Art Gallery |

Every landmark was checked against ROAM's own place filters (`studio/in-app.mjs`), every line was fact-checked including whether the place is open now (Heaton Park's heritage trams are out of service, so that shot shows the parkland), and every photo credit matches its Commons page.

How they were judged: nine rounds of a blind critic sub-agent working against a frozen 8-point rubric (frame 0, value in 2s, Meta/TikTok safe zone, no static holds, legibility, premium look, short end card, nothing embarrassing). Rounds 1-2 failed everything. The fixes that got these three through were: first cut at about 1s, a sharp photo in the top 1260px feathering into a blurred copy (so landscape photos aren't butchered by a 9:16 crop), one 1.5s end card, hand-picked Commons photos checked by eye, and swapping any shot where the title sat on the venue's own signage.

**Cut and why**, so you don't redo the same work:
- **App gap found:** ROAM's place filters drop libraries, towers and cemeteries, so John Rylands Library, Manchester Central Library, the Brighton i360 and the Glasgow Necropolis never appear in the app. Big-city town pages also only show a top few per group, so landmarks like the Albert Dock are missing from them. Both are fixes in `api/lib/towns.js` (`townOverpassQuery` and the grouping), not video fixes.
- **I'm Bored screen reels:** they read as "screen recording with captions". They need native iOS Simulator footage at 60fps to work.
- **Rainy-day reels:** the "Rainy weekend in…" hook over blue-sky photos contradicted itself. Doable with genuinely wet imagery.
- **Cardiff:** only two strong photos on Commons (castle, museum); the park shots are black and white. Add it when better photos turn up.
- **Posting notes from the fact check:** the Laing Art Gallery is closed on Sundays; Back to Backs is pre-booked tours only; Birmingham Museum & Art Gallery is partly reopened (the Staffordshire Hoard gallery is open).
- **Your three earlier reels, shortened:** their text sits in the bottom 670px, where TikTok/IG captions cover it, and the Remotion source for them is gone.

## 5. Measure it

- Bio link UTMs above show in PostHog as first-touch `utm_source` on web visitors.
- Weekly (Sunday, 15 min): installs by source (App Store Connect, Play Console), `town_page_view` and `store_click` in PostHog, and each reel's 2-second hold and watch %.
- The bigger gaps are in the app, not the content. `GROWTH-STRATEGY.md` §1.4 and §5.3 list the missing funnel events (no swipe, plan or app-open tracking, so native D7 is undercounted) and the push opt-in bottleneck (13 users have push). Fix those before putting money into ads.

## 6. Licences and credits

- **Music:** Kevin MacLeod (incompetech.com), CC BY 4.0. Commercial use is allowed with the credit line in the caption. For an ad format that hides the caption (Spark Ads, partnership ads), buy incompetech's paid licence or swap to a no-attribution Pixabay track.
- **Place photos:** Wikimedia Commons. Each frame credits author and licence on screen, and each caption lists them. Some are CC BY-SA, see the concerns in the final report before running these as paid ads.
- **App UI:** real screenshots of go-roam.uk taken 4 Oct 2026.
