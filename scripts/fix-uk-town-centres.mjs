/**
 * Moves every town in shared/ukTowns.mjs onto its OpenStreetMap place node (the town
 * centre), without re-geocoding. gen-uk-towns.mjs used to store the geocoder's point,
 * which for big cities is the boundary's centroid (Liverpool: Allerton, ~5 km from the
 * waterfront), so town pages missed the centre. gen-uk-towns.mjs now stores the node;
 * this applies the same fix to the shipped table.
 *
 *   node scripts/fix-uk-town-centres.mjs          # cities: writes shared/ukTowns.mjs
 *   ALL=1 node scripts/fix-uk-town-centres.mjs    # every town (slow, rate-limited)
 *   DRY=1 node scripts/fix-uk-town-centres.mjs    # report only
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { slugify } from '../shared/townSlug.mjs'
import { UK_TOWNS } from '../shared/ukTowns.mjs'
import { distanceKm } from '../api/lib/towns.js'

const UA = 'ROAM/1.0 (+https://www.go-roam.uk; support@extrastaff.com)'
// Public mirrors refuse or time out on big tiles (checked 7 Oct 2026: only overpass-api.de
// answered, and only small boxes), so 1-degree tiles, one at a time
const MIRRORS = ['https://overpass-api.de/api/interpreter']
// Tiles are cached so a run that hits the rate limit resumes where it stopped
const CACHE = '/tmp/uk-town-nodes'
mkdirSync(CACHE, { recursive: true })
const TILES = []
for (let lat = 49; lat < 61; lat++) for (let lng = -9; lng < 2; lng++) TILES.push([lat, lng, lat + 1, lng + 1])
const NEAR_KM = 15 // as gen-uk-towns.mjs verified
const MOVE_KM = 0.3 // smaller differences are rounding, not a wrong centre

async function tile([s, w, n, e]) {
  const file = `${CACHE}/${s}_${w}.json`
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const elements = await fetchTile([s, w, n, e])
  writeFileSync(file, JSON.stringify(elements))
  return elements
}

async function fetchTile([s, w, n, e], place = 'city|town') {
  const q = `[out:json][timeout:60];node(${s},${w},${n},${e})["place"~"^(${place})$"]["name"];out;`
  for (let round = 0; round < 8; round++) {
    if (round) await new Promise(r => setTimeout(r, 30000 * round)) // rate limited: back off
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(90000) })
        const data = JSON.parse(res.ok ? await res.text() : '')
        if (!data.remark && Array.isArray(data.elements)) return data.elements // a sea tile is legitimately empty
      } catch { /* next mirror */ }
    }
  }
  throw new Error(`tile ${s},${w} failed on every mirror`)
}

// Default source: Wikidata (one SPARQL query, every UK city and town with its coordinate,
// which is the centre). Public Overpass was refusing these queries on 7 Oct 2026 (504/406).
async function wikidataTowns() {
  const sparql = `SELECT ?name ?coord WHERE {
    VALUES ?kind { wd:Q515 wd:Q3957 wd:Q1549591 wd:Q1115575 wd:Q21130185 }
    ?item wdt:P31 ?kind; wdt:P17 wd:Q145; wdt:P625 ?coord; rdfs:label ?name. FILTER(LANG(?name) = "en") }`
  // direct P31 only: following subclasses (wdt:P31/wdt:P279*) times out on the public endpoint
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(90000) })
      if (res.ok) {
        // skip coordinates that aren't plain Earth points (other globes carry a URI prefix)
        return (await res.json()).results.bindings.flatMap(b => {
          const m = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/.exec(b.coord.value)
          return m ? [{ lat: +m[2], lon: +m[1], tags: { name: b.name.value } }] : []
        })
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 15000 * (i + 1)))
  }
  throw new Error('Wikidata query failed')
}

// SOURCE=overpass uses OSM place nodes instead. Cities only there by default: one small UK-wide query. That's where the geocoder's boundary
// centroid lands far from the centre (towns resolve to their node or a small boundary).
// ALL=1 also walks every 1-degree tile for place=town (slow; public mirrors rate-limit it)
const overpass = process.env.SOURCE === 'overpass'
const nodes = !overpass ? await wikidataTowns() : process.env.ALL ? [] : await fetchTile([49, -9, 61, 2], 'city')
if (overpass && process.env.ALL) {
  for (const [i, t] of TILES.entries()) {
    nodes.push(...await tile(t))
    if ((i + 1) % 10 === 0) console.log(`tiles ${i + 1}/${TILES.length}, ${nodes.length} place nodes`)
    await new Promise(r => setTimeout(r, 2000))
  }
}
const byName = new Map()
for (const e of nodes) {
  const key = slugify(e.tags['name:en'] || e.tags.name)
  if (!byName.has(key)) byName.set(key, [])
  byName.get(key).push({ lat: e.lat, lng: e.lon })
}

// Wikidata is the detector, not the fix: for small places its point can be a parish centroid
// or rounded (York would move 1.8 km south of the Minster). A town Wikidata puts >= SUSPECT_KM
// away is checked against its OSM boundary's own centre: the relation's label/admin_centre node.
const SUSPECT_KM = 1.5
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
      if (res.ok) return await res.json()
    } catch { /* retry */ }
    await sleep(3000 * (i + 1))
  }
  return null
}
async function boundaryCentre(town) {
  await sleep(1100) // Nominatim: 1 request per second
  const q = encodeURIComponent(`${town.name}, ${town.region || ''}, United Kingdom`)
  const hit = (await getJson(`https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&limit=1&featureType=settlement`))?.[0]
  if (!hit || hit.osm_type !== 'relation') return null // a node already is the centre
  const rel = (await getJson(`https://api.openstreetmap.org/api/0.6/relation/${hit.osm_id}.json`))?.elements?.[0]
  const member = rel?.members?.find(m => m.type === 'node' && m.role === 'label') || rel?.members?.find(m => m.type === 'node' && m.role === 'admin_centre')
  // A city boundary naming no centre (Birmingham): Wikidata's point, reliable for cities
  if (!member) return hit.addresstype === 'city' ? 'wikidata' : null
  const node = (await getJson(`https://api.openstreetmap.org/api/0.6/node/${member.ref}.json`))?.elements?.[0]
  return node ? { lat: node.lat, lng: node.lon } : null
}

let moved = 0, unmatched = 0
const report = []
const fixed = []
for (const town of UK_TOWNS) fixed.push(await centreOf(town))
async function centreOf(town) {
  // the slug may be county-qualified ("perth-perth-and-kinross"): match on the town's own name
  const near = (byName.get(slugify(town.name)) || []).filter(n => distanceKm(n, town) <= NEAR_KM)
  if (!near.length) { unmatched++; return town }
  const node = near.reduce((a, b) => (distanceKm(a, town) <= distanceKm(b, town) ? a : b))
  if (distanceKm(node, town) < (overpass ? MOVE_KM : SUSPECT_KM)) return town
  const found = overpass ? node : await boundaryCentre(town)
  const centre = found === 'wikidata' ? node : found
  if (!centre) return town
  const d = distanceKm(centre, town)
  if (d < MOVE_KM || d > NEAR_KM) return town
  moved++
  report.push([d, town.slug])
  return { ...town, lat: Math.round(centre.lat * 1e5) / 1e5, lng: Math.round(centre.lng * 1e5) / 1e5 }
}
report.sort((a, b) => b[0] - a[0])
console.log(`${nodes.length} ${overpass ? 'OSM place nodes' : 'Wikidata towns'}; ${UK_TOWNS.length} towns: ${moved} moved >= ${MOVE_KM} km, ${unmatched} unmatched (kept)`)
console.log('largest moves:', report.slice(0, 25).map(([d, s]) => `${s} ${d.toFixed(1)}km`).join(', '))
if (process.env.DRY) process.exit(0)
const OUT = new URL('../shared/ukTowns.mjs', import.meta.url)
// Replace only the UK_TOWNS line: the file also exports UK_TOWN_SLUGS (the sitemap's) after it
const text = readFileSync(OUT, 'utf8')
const start = text.indexOf('export const UK_TOWNS = ')
const end = text.indexOf('\n', start)
writeFileSync(OUT, `${text.slice(0, start)}export const UK_TOWNS = ${JSON.stringify(fixed)}${text.slice(end)}`)
console.log('wrote shared/ukTowns.mjs')
