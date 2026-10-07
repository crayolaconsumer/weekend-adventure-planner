# Reel studio

Remotion project that turns ROAM town pages into beat-synced "Things to do in <town>" reels and matching Instagram carousels. Remotion is free for ROAM (free licence for companies of 3 or fewer people).

## Setup (once)

```bash
cd marketing-assets/social-launch/studio
npm install
python3 -m venv venv && ./venv/bin/pip install librosa            # beat detection
mkdir -p public/music out
for t in "Inspired" "Funky Chunk" "Happy Bee - Surf" "Funin and Sunin" "Life of Riley"; do
  f=$(echo "$t" | tr 'A-Z ' 'a-z-' | tr -dc 'a-z-')
  curl -sL -o "public/music/$f.mp3" "https://incompetech.com/music/royalty-free/mp3-royaltyfree/${t// /%20}.mp3"
  ./venv/bin/python beats.py public/music/$f.mp3 > public/music/$f.beats.json
done
cp $(git rev-parse --show-toplevel)/public/icons/icon.svg public/
npm test                                                          # credit parser
```

The town photos (`public/towns/`) aren't committed. `node fetch-town.mjs <slug> 12` re-downloads any town; the hand-picked photos in `hd-photos.json` re-download with `node download.mjs <url> public/<img>` (each entry has its Commons file title).

## Make a new town reel (about 15 minutes)

1. **Big cities:** the town page only shows a top few per group, so famous landmarks can be missing (Albert Dock, Tate Modern). Pick the landmarks yourself and confirm ROAM really serves them: `node in-app.mjs "Royal Albert Dock, Liverpool" "Tate Modern, London"` applies the app's own OSM tag filters (`api/lib/towns.js`) and prints IN/OUT. Only use IN places. Smaller towns: `node fetch-town.mjs leeds 12` pulls the live go-roam.uk town page, keeps places with a Wikidata photo at least 1200px tall, and saves photo + author + licence.
2. **Look at every photo.** This is the step that matters. Five rounds of blind review rejected: brick walls, mostly-sky shots, interiors nobody recognises, photos whose own shop sign sits under the title, dated exhibition banners, and photos taken somewhere else. For a weak one, `node commons-search.mjs "<place> <town>" /tmp/c/<name>` lists better Commons photos. Check the file **title** says what you think it shows, then `node add-hd.mjs <key> <town> "File:<title>.jpg"` downloads it and records the credit from Commons.
3. Add the reel to `REELS` in `plan.mjs`: a `hookPhoto` that is **not** one of the places (a skyline or the town's signature view), then 3-4 places, either `[townPageIndex, 'line', photoOverride?]` or `{ name, tag, line, photo: hd('key') }` for IN landmarks. Only write lines you've verified; check any "Free" claim on the venue's site.
4. `npm run plan` writes `src/reels.json` and `out/captions.md`.
5. `npm run verify`. Every on-screen photo credit must match its Commons page (exits 1 on a mismatch; `node verify-credits.mjs --fix` writes Commons' credit back, then re-run step 4).
6. Preview with `npm run studio`, then render and normalise loudness:
   ```bash
   npx remotion render src/index.tsx leeds-things out/raw.mp4 --crf=18 --audio-bitrate=192k
   ffmpeg -i out/raw.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k -movflags +faststart out/leeds-things.mp4
   npx remotion render src/index.tsx carousel-leeds-things out/carousels/leeds-things --sequence --image-format=png
   ```

## Files

| File | Job |
|---|---|
| `fetch-town.mjs` | Town page HTML → places in the app's ranking → Wikidata P18 photo → Commons original, author, licence |
| `download.mjs` | Downloads a Commons original with retry (Wikimedia rate-limits bursts with an HTML page) and scales it to 2200px tall |
| `credit.mjs` + `credit.test.mjs` | Turns Commons' messy author field into a clean credit ("Photograph by X .", "X~commonswiki assumed", "Flickr:X aka Y") |
| `verify-credits.mjs` | Re-checks every credit in the rendered plan against Commons |
| `commons-search.mjs` | Finds better photos for a place |
| `in-app.mjs` | Checks a landmark passes ROAM's own place filters before it goes in an ad |
| `add-hd.mjs` | Downloads a hand-picked Commons photo and records its credit |
| `beats.py` | Tempo, beat times and the loudest 20s of a track |
| `plan.mjs` | Reel definitions → `src/reels.json`. Scene lengths are in beats, so every cut lands on a beat |
| `src/Reel.tsx` | The look: hook on frame 0, punch-in and whip entrances, Ken Burns, word-by-word type, photo in the top 1260px feathering into a blurred copy, end card. Text stays inside the TikTok/Meta safe zone (top 270px, bottom 670px, right 150px) |
| `src/Stills.tsx` | Carousels and profile images |
| `captions.mjs` | Captions built from the same data, so caption and video can't disagree |
