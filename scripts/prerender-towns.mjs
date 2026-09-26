/**
 * Post-build: generate per-town SEO pages (dist/town/<slug>/index.html)
 * from live Overpass queries. Self-contained static HTML - no SPA route,
 * no DB, no new API. Place links go to the real /place/:id pages.
 * If Overpass is unreachable a town is skipped; the build must never fail
 * on an external service (same fallback philosophy as api/sitemap.js).
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const SITE = 'https://www.go-roam.uk'
const PER_TOWN = 24
const sleep = ms => new Promise(r => setTimeout(r, ms))
import { TOWNS } from '../shared/towns.mjs'

// Route through the production Overpass proxy (api/places/overpass/nearby):
// it carries the OSM-policy User-Agent, the curated mirror list with
// failover, and the KV cache. Direct Overpass calls from build IPs get
// 406/429/504 (observed 2026-09-25); the proxy is the app's own working path.
const PROXY = 'https://www.go-roam.uk/api/places/overpass/nearby'

async function fetchTown(town) {
  const d = 0.03 // ~3.3km vertical, scaled for longitude
  // Overpass bbox order is south,west,north,east (lat first)
  const bbox = `${town.lat - d},${town.lng - d * 1.3},${town.lat + d},${town.lng + d * 1.3}`
  const query = `[bbox:${bbox}][out:json][timeout:25];` +
    `(
  nwr["amenity"~"^(cafe|restaurant|bar|fast_food|pub)$"]["name"];
  nwr["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|historic_building|artwork|memorial)$"]["name"];
  nwr["leisure"~"^(picnic_site|park|garden|playground)$"]["name"];
  nwr["natural"~"^(wood|water)$"]["name"];
  );
  out center 250;`
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(55000)
      })
      if (!res.ok) throw new Error(`proxy ${res.status}`)
      const json = await res.json()
      const seen = new Set()
      const all = []
      for (const el of json.elements || []) {
        const name = el.tags && el.tags.name
        if (!name || seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        const lat = el.lat ?? (el.center && el.center.lat)
        const lng = el.lon ?? (el.center && el.center.lon)
        if (!lat || !lng) continue
        const kind = el.tags.amenity || el.tags.tourism || el.tags.leisure || el.tags.natural
        all.push({ id: el.id, name, kind, lat, lng })
      }
      // ponytail: Overpass returns elements in ID order, so a plain slice
      // puts Starbucks ahead of the Minster. Landmark-ish kinds rank first;
      // ties keep ID order. If the mix changes, tune the set.
      const LANDMARKS = new Set(['attraction', 'museum', 'gallery', 'zoo', 'theme_park', 'historic_building', 'artwork', 'memorial', 'viewpoint', 'park', 'garden', 'picnic_site', 'wood', 'water'])
      all.sort((a, b) => (LANDMARKS.has(a.kind) ? 0 : 1) - (LANDMARKS.has(b.kind) ? 0 : 1))
      const places = all.slice(0, PER_TOWN)
      if (places.length === 0) throw new Error('no places')
      return places
    } catch (err) {
      lastErr = err
      await sleep(5000)
    }
  }
  throw lastErr
}

const escape = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function page(town, places) {
  const url = `${SITE}/town/${town.slug}`
  const d = escape(town.blurb)
  const t = `Explore ${escape(town.name)} — best places for a weekend | ROAM`
  const items = places
    .map(p => `      <li><a href="/place/${p.id}">${escape(p.name)}</a><span>${escape(p.kind || '')}</span></li>`)
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:image" content="${SITE}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${url}" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500&family=Outfit:wght@400;600&display=swap" />
  <style>
    /* Colours are the app's dark-theme tokens (src/index.css [data-theme="dark"]) */
    :root { color-scheme: dark; }
    body { margin: 0; background: #0d1b16; color: #f4ecdc; font: 16px/1.55 'Outfit', system-ui, sans-serif; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid #1f3a30; }
    header a { color: #8fbfa3; text-decoration: none; font-weight: 600; }
    header a.brand { font-family: 'Newsreader', Georgia, serif; font-size: 1.4rem; font-weight: 500; letter-spacing: 0.08em; color: #f4ecdc; }
    main { max-width: 640px; margin: 0 auto; padding: 24px 20px 48px; }
    h1 { font-family: 'Newsreader', Georgia, serif; font-weight: 500; font-size: 2.25rem; margin: 0 0 8px; }
    p.lead { margin: 0 0 24px; color: #d0c5b0; }
    ul { list-style: none; padding: 0; margin: 0 0 28px; }
    li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; background: #faf8f5; border-radius: 16px; margin-bottom: 8px; }
    li a { color: #2a2520; text-decoration: none; font-weight: 600; }
    li span { background: #a8c4ae; color: #1a3a2f; font-size: 0.75rem; padding: 2px 10px; border-radius: 9999px; text-transform: capitalize; white-space: nowrap; }
    .cta { display: inline-block; background: #e07a5f; color: #fff; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 9999px; }
    footer { text-align: center; color: #8a8275; padding: 24px; font-size: 0.85rem; }
    footer a { color: #8fbfa3; }
  </style>
</head>
<body>
  <header>
    <a class="brand" href="/">ROAM</a>
    <a href="/get-roam">Get the app</a>
  </header>
  <main>
    <h1>${escape(town.name)}</h1>
    <p class="lead">${d}</p>
    <ul>
${items}
    </ul>
    <a class="cta" href="/">Open in ROAM</a>
  </main>
  <footer>ROAM — stop scrolling, start roaming. <a href="/events">What's On</a> · <a href="/pricing">Pricing</a> · <a href="/partners">Partners</a></footer>
</body>
</html>
`
}

let ok = 0
const start = Date.now()
// ponytail: hard 5-minute budget for this phase - if Overpass is badly
// throttled, ship the site without town pages instead of timing out the
// whole Vercel build.
for (const town of TOWNS) {
  if (Date.now() - start > 5 * 60 * 1000) {
    console.log('town budget exhausted, skipping remaining towns')
    break
  }
  try {
    const places = await fetchTown(town)
    if (places.length === 0) throw new Error('no places')
    const dir = `dist/town/${town.slug}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/index.html`, page(town, places))
    ok++
    console.log(`town: ${town.slug} (${places.length} places)`)
  } catch (err) {
    console.error(`town: ${town.slug} skipped - ${err.message}`)
  }
  await sleep(4000) // stay under Overpass load limits
}
console.log(`prerender-towns: wrote ${ok}/${TOWNS.length} town pages`)
