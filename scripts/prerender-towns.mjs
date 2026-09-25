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
const TOWNS = [
  { slug: 'birmingham', name: 'Birmingham', lat: 52.4862, lng: -1.8904, blurb: 'Parks, food markets and live music across one of England\'s biggest cities.' },
  { slug: 'leeds', name: 'Leeds', lat: 53.8008, lng: -1.5491, blurb: 'Riverside parks, the Headrow and a strong independent food and music scene.' },
  { slug: 'bristol', name: 'Bristol', lat: 51.4543, lng: -2.5973, blurb: 'Harbourside, street art and independent cafés in a city that leans out.' },
  { slug: 'manchester', name: 'Manchester', lat: 53.4808, lng: -2.2426, blurb: 'Canal-side parks, music and a dense café scene in the centre.' },
  { slug: 'cardiff', name: 'Cardiff', lat: 51.4817, lng: -3.1792, blurb: 'Bay, castles and food markets in the Welsh capital.' },
  { slug: 'nottingham', name: 'Nottingham', lat: 52.9548, lng: -1.1581, blurb: 'Castle, parks and riverside walks close to the centre.' },
  { slug: 'leicester', name: 'Leicester', lat: 52.6369, lng: -1.1398, blurb: 'Jubilee Gardens, the waterfront and a lively food scene.' },
  { slug: 'liverpool', name: 'Liverpool', lat: 53.4084, lng: -2.9951, blurb: 'Waterfront, museums and parks on the edge of the Mersey.' },
  { slug: 'newcastle', name: 'Newcastle', lat: 54.9783, lng: -1.6175, blurb: 'Quayside parks and the Tyne close to the centre.' },
  { slug: 'york', name: 'York', lat: 53.9578, lng: -1.0813, blurb: 'The Minster, the city walls and a compact historic centre.' },
  { slug: 'oxford', name: 'Oxford', lat: 51.752, lng: -1.2577, blurb: 'Rivers, parks and the oldest university city in England.' },
  { slug: 'cambridge', name: 'Cambridge', lat: 52.2053, lng: 0.1218, blurb: 'River Cam walks, gardens and college squares.' },
  { slug: 'bath', name: 'Bath', lat: 51.3811, lng: -2.3629, blurb: 'Roman baths, parks and Georgian streets that invite a slow day.' },
  { slug: 'brighton', name: 'Brighton', lat: 50.8214, lng: -0.1436, blurb: 'Seafront, gardens and a beach that pulls the whole city out.' },
  { slug: 'sheffield', name: 'Sheffield', lat: 53.3811, lng: -1.4701, blurb: 'Domes, parkland and valley parks ringing the city.' },
  { slug: 'derby', name: 'Derby', lat: 52.9226, lng: -1.4779, blurb: 'River Derwent walks and a compact centre by the rail station.' }
]

// Route through the production Overpass proxy (api/places/overpass/nearby):
// it carries the OSM-policy User-Agent, the curated mirror list with
// failover, and the KV cache. Direct Overpass calls from build IPs get
// 406/429/504 (observed 2026-09-25); the proxy is the app's own working path.
const PROXY = 'https://www.go-roam.uk/api/places/overpass/nearby'

async function fetchTown(town) {
  const d = 0.03 // ~3.3km vertical, scaled for longitude
  const bbox = `${town.lng - d * 1.3},${town.lat - d},${town.lng + d * 1.3},${town.lat + d}`
  const query = `[bbox:${bbox}][out:json][timeout:25];` +
    `(
  nwr["amenity"~"^(cafe|restaurant|bar|fast_food|pub)$"]["name"];
  nwr["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|historic_building)$"]["name"];
  nwr["leisure"~"^(picnic_site|park|garden|playground)$"]["name"];
  nwr["natural"~"^(wood|water)$"]["name"];
  );
  out center ${PER_TOWN + 16};`
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
      const places = []
      for (const el of json.elements || []) {
        const name = el.tags && el.tags.name
        if (!name || seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        const lat = el.lat ?? (el.center && el.center.lat)
        const lng = el.lon ?? (el.center && el.center.lon)
        if (!lat || !lng) continue
        const kind = el.tags.amenity || el.tags.tourism || el.tags.leisure || el.tags.natural
        places.push({ id: el.id, name, kind, lat, lng })
        if (places.length >= PER_TOWN) break
      }
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
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #0d1117; color: #e6edf3; font: 16px/1.55 system-ui, sans-serif; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid #21262d; }
    header a { color: #e6edf3; text-decoration: none; font-weight: 600; }
    main { max-width: 640px; margin: 0 auto; padding: 24px 20px 48px; }
    h1 { font-size: 1.6rem; margin: 0 0 8px; }
    p.lead { margin: 0 0 20px; color: #9aa4b2; }
    ul { list-style: none; padding: 0; margin: 0 0 24px; }
    li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid #21262d; border-radius: 10px; margin-bottom: 8px; }
    li a { color: #e6edf3; text-decoration: none; font-weight: 600; }
    li span { color: #9aa4b2; font-size: 0.85rem; }
    .cta { display: inline-block; background: #e8590c; color: #fff; font-weight: 700; text-decoration: none; padding: 12px 20px; border-radius: 12px; }
    footer { text-align: center; color: #9aa4b2; padding: 24px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <header>
    <a href="/">ROAM</a>
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
