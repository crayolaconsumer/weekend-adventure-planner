/**
 * Regenerates shared/ukTowns.mjs: sitemap slugs for every UK city and town
 * in OpenStreetMap (place=city|town nodes), each VERIFIED to open that town.
 * OSM data is cached in /tmp/uk-towns/osm-towns.json; delete it to refetch.
 *
 * The live page geocodes a slug worldwide, so a bare name can land abroad
 * ("perth" is Perth, Australia) or on another UK town ("newport"). For each
 * town we resolve the slug exactly as api/town.js does and keep it only if
 * it lands in the UK within 15km of the OSM town. Otherwise we try the
 * county-qualified slug ("perth-perth-and-kinross"), and drop the town if
 * that fails too.
 *
 *   node scripts/gen-uk-towns.mjs          # ~30-40 min: Nominatim allows 1 req/s
 *   tail -f /tmp/uk-towns/progress.log
 *
 * Runs without KV (nothing in production is touched). Needs network.
 */
import { writeFileSync, mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { slugify, isValidSlug } from '../shared/townSlug.mjs'
// Never touch production: without KV, resolveTown/nominatimGate run locally
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]
const { resolveTown, distanceKm, nominatimGate } = await import('../api/lib/towns.js')
const OUT = new URL('../shared/ukTowns.mjs', import.meta.url)
const MAX_ERRORS = 40

const LOG = '/tmp/uk-towns/progress.log'
mkdirSync('/tmp/uk-towns', { recursive: true })
const log = msg => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); appendFileSync(LOG, line + '\n') }

// Plain bbox tiles, no boundary (area) filter: public mirrors keep failing area
// queries (the .fr one has no area database at all). Tiles overlap Ireland and
// the French coast; verification drops those towns (they resolve outside GB).
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const UA = 'ROAM/1.0 (+https://www.go-roam.uk; support@extrastaff.com)'
const NEAR_KM = 15
const CACHE = '/tmp/uk-towns/osm-towns.json'
// One UK-wide query times out on busy mirrors; 8 tiles (still clipped to the UK) don't
const TILES = [[49.8, -8.7, 53, -3], [49.8, -3, 53, 1.8], [53, -8.7, 55, -3], [53, -3, 55, 1.8], [55, -8.7, 57.5, -3], [55, -3, 57.5, 1.8], [57.5, -8.7, 61, -3], [57.5, -3, 61, 1.8]]

async function fetchTile([s, w, n, e]) {
  const q = `[out:json][timeout:180];node(${s},${w},${n},${e})["place"~"^(city|town)$"]["name"];out;`
  for (let round = 0; round < 4; round++) {
    if (round) await new Promise(res => setTimeout(res, 20000))
    for (const url of MIRRORS) {
      // Busy mirrors answer 504, an empty 200, a 200 XML error page, or drop the connection
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(200000) })
        const data = JSON.parse(res.ok ? await res.text() : '')
        if (!data.remark && data.elements?.length) return data.elements
        log(`tile ${s},${w}: ${url} ${data.remark ? `remark ${data.remark.slice(0, 80)}` : 'empty'}`)
      } catch (err) { log(`tile ${s},${w}: ${url} ${err.message.slice(0, 60)}`) }
    }
  }
  throw new Error(`tile ${s},${w} failed on every mirror`)
}

let elements
if (existsSync(CACHE)) {
  elements = JSON.parse(readFileSync(CACHE, 'utf8'))
  log(`using cached OSM towns (${CACHE})`)
} else {
  elements = []
  for (const tile of TILES) elements.push(...await fetchTile(tile))
  writeFileSync(CACHE, JSON.stringify(elements))
}
if (elements.length < 500) throw new Error(`Only ${elements.length} towns from Overpass; refusing to continue`)

// The resolved record for every kept slug: shipped with the code so these
// towns never need the geocoder at request time (crawls were 503ing on it)
const records = {}

// 'yes' if this slug opens the town at this point (UK, near, canonical slug);
// 'abroad' if it's this very town but outside the UK (tile overlap); else 'no'
async function opens(slug, at) {
  if (!isValidSlug(slug)) return 'no'
  const town = await resolveTown(slug, { raw: true })
  if (!town || distanceKm(town, at) > NEAR_KM) return 'no'
  if (town.countryCode !== 'gb') return 'abroad'
  const canonical = slugify(town.name)
  if (slug !== canonical && !slug.startsWith(`${canonical}-`)) return 'no'
  records[slug] = town
  return 'yes'
}

async function county(at) {
  await nominatimGate()
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${at.lat}&lon=${at.lng}&format=jsonv2&zoom=8&addressdetails=1&accept-language=en`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
  const a = r.ok ? (await r.json()).address || {} : {}
  return a.county || a.state_district || a.state || ''
}

// ONLY=perth,newport,... checks just those names (a dry run; nothing is written)
const only = process.env.ONLY?.split(',').map(n => n.trim().toLowerCase())
const towns = elements.map(e => ({ name: e.tags['name:en'] || e.tags.name, lat: e.lat, lng: e.lon }))
  .filter(t => !only || only.includes(t.name.toLowerCase()))
log(`verifying ${towns.length} OSM towns`)
const kept = new Set()
let qualified = 0, dropped = 0, abroad = 0, errors = 0

async function verify(t) {
  const bare = slugify(t.name)
  const first = kept.has(bare) ? 'no' : await opens(bare, t)
  if (first === 'yes') return kept.add(bare)
  if (first === 'abroad') return abroad++
  const q = slugify(`${t.name} ${await county(t)}`)
  if (q !== bare && !kept.has(q) && await opens(q, t) === 'yes') { kept.add(q); qualified++ } else dropped++
}
const started = Date.now()
for (const [i, t] of towns.entries()) {
  // One retry after a pause; a run of errors means we're blocked, so stop
  // rather than write a list missing towns
  try {
    await verify(t)
  } catch {
    await new Promise(res => setTimeout(res, 5000))
    try { await verify(t) } catch (err) {
      dropped++
      log(`error ${t.name}: ${err.message}`)
      if (++errors > MAX_ERRORS) throw new Error(`${errors} lookups failed; Nominatim may be blocking us. Not writing a partial list.`)
    }
  }
  if ((i + 1) % 50 === 0) {
    const rate = (i + 1) / ((Date.now() - started) / 1000)
    log(`uk-towns ${Math.round((i + 1) / towns.length * 100)}% ${i + 1}/${towns.length}, ETA ${Math.round((towns.length - i - 1) / rate / 60)} min, kept ${kept.size}, qualified ${qualified}, dropped ${dropped}, abroad ${abroad}`)
  }
}

const slugs = [...kept].sort()
if (only) { log(`dry run: ${JSON.stringify(slugs)}`); process.exit(0) }
// Featured text is applied on read (api/lib/towns.js), so records stay raw
const output = slugs.map(slug => {
  const { name, region, country, countryCode, lat, lng } = records[slug]
  return { slug, name, region, country, countryCode, lat, lng }
})
if (slugs.length < 500) throw new Error(`Only ${slugs.length} verified; refusing to overwrite with a partial list`)
writeFileSync(OUT, `// GENERATED by scripts/gen-uk-towns.mjs from OpenStreetMap (place=city|town nodes in the UK).
// Every slug is verified to open that UK town on /town/<slug>, with the geocoder's
// record so these pages never need Nominatim at request time. Do not edit by hand.
// ${output.length} towns.
export const UK_TOWNS = ${JSON.stringify(output)}
export const UK_TOWN_SLUGS = UK_TOWNS.map(t => t.slug)
`)
log(`done: ${slugs.length} slugs (${qualified} county-qualified, ${dropped} dropped, ${abroad} outside the UK)`)
