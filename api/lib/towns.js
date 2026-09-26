/**
 * Town pages: resolve any town on Earth by slug or coordinates, fetch its
 * best places, render the SEO page. Used by api/town.js (web HTML + app JSON).
 *
 * Geocoding is Nominatim (OSM). Its usage policy: identifying User-Agent,
 * max ~1 req/s, cache results. Every lookup here goes through KV first
 * (30 days for hits, 1 day for misses) and the rendered page sits behind
 * the Vercel CDN, so a town costs one Nominatim call per month, not per view.
 *
 * Pure helpers are exported for tests; network calls take an injectable
 * `fetchImpl` so tests never touch the real services.
 */

import { Redis } from '@upstash/redis'
import { cacheGet, cacheSet, isCacheEnabled } from './kvCache.js'
import { TOWNS } from '../../shared/towns.mjs'
import { CATEGORY_SVGS } from './brandSvgs.js'
import { haversineKm } from './promotedEventPush.js'
import { APP_STORE_ID, APP_STORE_URL, PLAY_STORE_URL } from '../../shared/appLinks.mjs'

const SITE = 'https://www.go-roam.uk'
const NOMINATIM = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'ROAM/1.0 (+https://www.go-roam.uk; support@extrastaff.com)'
const GEO_TTL = 30 * 24 * 60 * 60
const MISS_TTL = 24 * 60 * 60
// A near-me slug must resolve back to within this distance of the user,
// otherwise the bare name picked a same-named town elsewhere.
const NEAR_MATCH_KM = 25
// ~3.3km each way, same box the app's TownPage searches
const HALF_BOX_DEG = 0.03
const PER_GROUP = 8

// ─── Slugs ───────────────────────────────────────────────────────

import { slugify, isValidSlug } from '../../shared/townSlug.mjs'
export { slugify, isValidSlug }

const normalise = s => slugify(s).replace(/-/g, ' ')
const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase())

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Human name for the page. Nominatim's `name` is right most of the time
 * ("São Paulo", "St Albans") but sometimes names the admin area instead
 * ("Greater London" for london, "Borough of Luton" for luton); then the
 * slug's own words are the better title. Only admin wrappers count: a
 * different town that merely contains the words ("Leigh-on-Sea" for leigh)
 * keeps its own name, and the URL is corrected to match.
 */
export function pickDisplayName(slug, resultName) {
  const s = slug.replace(/-/g, ' ')
  const n = normalise(resultName || '')
  if (!n) return titleCase(s)
  if (s === n || s.startsWith(n + ' ')) return resultName
  const adminWrapped = new RegExp(`^(greater |(royal |metropolitan |london )?borough of |city (and county )?of |county of |municipality of )?${escapeRe(s)}( city| borough| district| municipality)?$`)
  if (adminWrapped.test(n)) return titleCase(s)
  return resultName
}

/** Locality from a zoom-14 reverse geocode: town beats city (Hatfield, not Welwyn Hatfield). */
export function localityFromAddress(address = {}) {
  return address.town || address.village || address.city || address.municipality || address.county || null
}

export const distanceKm = (a, b) => haversineKm(a.lat, a.lng, b.lat, b.lng)

// ─── Geocoding ───────────────────────────────────────────────────

// Nominatim's policy is max 1 req/s for the whole app, not per instance.
// A KV lock (SET NX, 1.1s expiry) spaces calls across every serverless
// instance; without KV (local dev, tests) a module timestamp does it.
const GATE_MS = 1100
const GATE_TRIES = 4
let redis
let lastLocalCall = 0
const sleep = ms => new Promise(r => setTimeout(r, ms))

function gateClient() {
  if (redis === undefined) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    redis = url && token ? new Redis({ url, token }) : null
  }
  return redis
}

/** Wait for a Nominatim slot; throws (→ 503, uncached) if the app is saturated. */
export async function nominatimGate({ client = gateClient(), wait = sleep } = {}) {
  if (!client) {
    const delay = lastLocalCall + GATE_MS - Date.now()
    lastLocalCall = Date.now() + Math.max(0, delay)
    if (delay > 0) await wait(delay)
    return
  }
  for (let i = 0; i < GATE_TRIES; i++) {
    if (await client.set('nominatim:gate', '1', { nx: true, px: GATE_MS }) === 'OK') return
    await wait(GATE_MS)
  }
  throw new Error('nominatim busy')
}

async function nominatim(path, fetchImpl, gate = nominatimGate) {
  await gate()
  const res = await fetchImpl(`${NOMINATIM}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`nominatim ${res.status}`)
  return res.json()
}

async function cached(key, ttlFor, compute) {
  if (isCacheEnabled()) {
    const hit = await cacheGet(key)
    if (hit) return hit.value
  }
  const value = await compute()
  if (isCacheEnabled()) await cacheSet(key, { value }, ttlFor(value)).catch(() => {})
  return value
}

// Settlement search can still return a whole state, country or admin district.
// Not 'county': York and Luton genuinely come back as addresstype "county".
const NOT_A_TOWN = new Set(['state', 'region', 'country', 'continent', 'province', 'state_district', 'subdistrict'])

/** Town record from a Nominatim search result, or null if it isn't a usable town. */
export function townFromResult(slug, r) {
  const lat = parseFloat(r?.lat)
  const lng = parseFloat(r?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || NOT_A_TOWN.has(r.addresstype)) return null
  const a = r.address || {}
  const featured = TOWNS.find(t => t.slug === slug)
  return {
    slug,
    name: featured ? featured.name : pickDisplayName(slug, r.name),
    region: a.county || a.state || null,
    country: a.country || null,
    countryCode: a.country_code || null,
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    blurb: featured ? featured.blurb : null
  }
}

async function searchSettlement(text, fetchImpl, gate) {
  const results = await nominatim(
    `/search?q=${encodeURIComponent(text)}&format=jsonv2&limit=1&addressdetails=1&featureType=settlement&accept-language=en`,
    fetchImpl, gate
  )
  return Array.isArray(results) && results[0] ? results[0] : null
}

/** Resolve a slug to a town, or null if nothing matches. Errors throw (so they aren't cached). */
export async function resolveTown(slug, { fetchImpl = fetch, gate } = {}) {
  return cached(`town:geo:${slug}`, v => v ? GEO_TTL : MISS_TTL, async () => {
    const r = await searchSettlement(slug.replace(/-/g, ' '), fetchImpl, gate)
    return r ? townFromResult(slug, r) : null
  })
}

/**
 * Free-text search box input → slug. Usually just slugify; text with no Latin
 * form (東京, Москва) is looked up and slugged from its English name (tokyo).
 */
export async function slugForQuery(text, { fetchImpl = fetch, gate } = {}) {
  const direct = slugify(text)
  if (isValidSlug(direct)) return direct
  const trimmed = String(text).trim().slice(0, 100)
  if (!trimmed) return null
  const r = await searchSettlement(trimmed, fetchImpl, gate)
  const slug = r && slugify(r.name || '')
  return slug && isValidSlug(slug) ? slug : null
}

/**
 * Coordinates → the canonical slug for the town the user is standing in.
 * Bare name first ("hatfield"); if that resolves somewhere else (there are
 * several Hatfields), qualify it with the county ("hatfield-hertfordshire").
 */
export async function resolveNear(lat, lng, { fetchImpl = fetch, gate } = {}) {
  // ~1km grid so neighbours share one cache entry and we never store exact positions
  const key = `town:near:${lat.toFixed(2)},${lng.toFixed(2)}`
  return cached(key, v => v ? GEO_TTL : MISS_TTL, async () => {
    const r = await nominatim(
      `/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&format=jsonv2&zoom=14&addressdetails=1&accept-language=en`,
      fetchImpl, gate
    )
    const a = r.address || {}
    const locality = localityFromAddress(a)
    if (!locality) return null
    const here = { lat, lng }
    const region = a.county || a.state_district || a.state || a.province || a.region || ''
    const candidates = [slugify(locality), slugify(`${locality} ${region}`)]
      .filter((s, i, arr) => isValidSlug(s) && arr.indexOf(s) === i)
    for (const slug of candidates) {
      const town = await resolveTown(slug, { fetchImpl, gate })
      if (town && distanceKm(here, town) <= NEAR_MATCH_KM) return town
    }
    return null
  })
}

// ─── Places ──────────────────────────────────────────────────────

export const GROUPS = [
  { key: 'sights', title: 'Sights & Culture', kinds: ['attraction', 'museum', 'gallery', 'zoo', 'theme_park', 'historic_building', 'artwork', 'memorial', 'viewpoint', 'castle', 'manor', 'monument', 'ruins', 'archaeological_site', 'place_of_worship'] },
  { key: 'outdoors', title: 'Nature & Outdoors', kinds: ['park', 'garden', 'nature_reserve', 'picnic_site', 'wood', 'water', 'beach'] },
  { key: 'food', title: 'Food & Drink', kinds: ['cafe', 'restaurant', 'pub', 'bar', 'fast_food'] }
]
const KIND_TO_GROUP = Object.fromEntries(GROUPS.flatMap(g => g.kinds.map(k => [k, g.key])))
// Rivers and canals are natural=water too; their huge areas beat every real park
const NOT_A_DESTINATION_WATER = new Set(['river', 'canal', 'stream', 'ditch', 'drain', 'channel', 'tidal_channel', 'basin', 'lock', 'wastewater', 'moat', 'fishpass'])

// Each category gets its own output cap: one shared cap let Paris's cafés
// crowd out every park. Caps cut in OSM ID order, not importance, so notable
// (Wikidata-linked) sights and parks get their own statement first. Places of
// worship only when notable, so Kyoto gets its temples without every parish
// hall. `out tags bb`: tags plus bounds (parks rank by size), no node lists.
export function townOverpassQuery(lat, lng) {
  const d = HALF_BOX_DEG
  const w = d * 1.3 // wider in longitude so the box is roughly square at UK latitudes
  const bbox = `${(lat - d).toFixed(4)},${(lng - w).toFixed(4)},${(lat + d).toFixed(4)},${(lng + w).toFixed(4)}`
  return `[bbox:${bbox}][out:json][timeout:25];` +
    'nwr["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park)$"]["name"]["wikidata"];out tags bb 150;' +
    'nwr["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|artwork|memorial)$"]["name"];out tags bb 100;' +
    'nwr["historic"~"^(castle|manor|monument|ruins|archaeological_site)$"]["name"];out tags bb 60;' +
    'nwr["amenity"="place_of_worship"]["name"]["wikidata"];out tags bb 40;' +
    'nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]["wikidata"];out tags bb 120;' +
    'nwr["leisure"~"^(park|garden|nature_reserve|picnic_site)$"]["name"];out tags bb 100;' +
    'nwr["natural"~"^(wood|water|beach)$"]["name"];out tags bb 40;' +
    'nwr["amenity"~"^(cafe|restaurant|bar|pub)$"]["name"];out tags bb 150;'
}

// Well-documented places first; chains last so the Minster beats Starbucks,
// and street art last so Hatfield House beats a sundial. Fame: the number of
// name:xx translations (Eiffel Tower ~50, a local square 0-2) is the best
// importance signal OSM carries.
export function placeScore(tags = {}) {
  const translations = Object.keys(tags).filter(k => k.startsWith('name:')).length
  return Math.min(translations, 60) / 3 + (tags.wikidata ? 3 : 0) + (tags.wikipedia ? 3 : 0) + (tags.website ? 1 : 0) +
    (tags.opening_hours ? 1 : 0) + (tags.image ? 1 : 0) - (tags.brand ? 2 : 0) -
    (tags.tourism === 'artwork' || tags.historic === 'memorial' ? 2 : 0) -
    (tags.amenity === 'place_of_worship' ? 1 : 0)
}

// English name when the local one isn't in Latin script (京都タワー → Kyoto Tower);
// Latin-script names stay local (Musée de l'Armée, not "Army Museum")
const NON_LATIN = /(?!\p{Script=Latin})\p{L}/u
export const displayPlaceName = (tags = {}) =>
  (tags.name && NON_LATIN.test(tags.name) && tags['name:en']) || tags.name

/** Overpass elements → { groups: [{key,title,total,places}], total } */
export function groupPlaces(elements = []) {
  const seen = new Set()
  const byGroup = Object.fromEntries(GROUPS.map(g => [g.key, []]))
  for (const el of elements) {
    const tags = el.tags || {}
    const name = displayPlaceName(tags)
    const b = el.bounds
    const lat = el.lat ?? el.center?.lat ?? (b && (b.minlat + b.maxlat) / 2)
    const lng = el.lon ?? el.center?.lon ?? (b && (b.minlon + b.maxlon) / 2)
    if (!name || lat == null || lng == null) continue
    const kind = tags.tourism || tags.historic || tags.leisure || tags.natural || tags.amenity
    const group = KIND_TO_GROUP[kind]
    if (!group || seen.has(name.toLowerCase())) continue
    if (kind === 'water' && (NOT_A_DESTINATION_WATER.has(tags.water) || tags.waterway)) continue
    seen.add(name.toLowerCase())
    // Parks rank by size (Luxembourg over a corner square); nodes have no bounds
    const area = b ? (b.maxlat - b.minlat) * (b.maxlon - b.minlon) : 0
    // Ways and relations get typed ids (w123 / r123): they share numbers with
    // nodes, see fetchPlaceById. Nodes stay bare so they match ids already
    // saved from Discover and still open in app versions without typed ids.
    const id = el.type === 'way' || el.type === 'relation' ? `${el.type[0]}${el.id}` : el.id
    // Hints for /api/places/image-resolve, the same photo resolver the app uses
    const photo = Object.fromEntries(Object.entries({
      wikipedia: tags.wikipedia, wikidata: tags.wikidata, website: tags.website,
      // Only a File: is a photo; "Category:Tour Eiffel" isn't, and would beat Wikipedia's
      commons: /^File:/i.test(tags.wikimedia_commons || '') ? tags.wikimedia_commons : undefined
    }).filter(([, v]) => v))
    byGroup[group].push({ id, name, kind, lat, lng, photo, score: placeScore(tags), area })
  }
  const groups = GROUPS.map(g => {
    // stable sort: ties keep Overpass order
    const all = byGroup[g.key].sort(g.key === 'outdoors'
      ? (a, b) => b.area - a.area || b.score - a.score
      : (a, b) => b.score - a.score)
    const places = all.slice(0, PER_GROUP).map(({ score, area, ...p }) => p) // eslint-disable-line no-unused-vars
    return { key: g.key, title: g.title, total: all.length, places }
  }).filter(g => g.total > 0)
  return { groups, total: groups.reduce((n, g) => n + g.total, 0) }
}

// Output caps make big-city totals a lower bound, so never claim false precision
export const roundCount = n => n >= 20 ? `${Math.floor(n / 10) * 10}+` : String(n)

/** One honest sentence built from what was actually found. */
export function describeTown(town, grouped) {
  if (town.blurb) return town.blurb
  const where = [town.name, town.region && town.region !== town.name ? town.region : null].filter(Boolean).join(', ')
  const count = key => grouped.groups.find(g => g.key === key)?.total || 0
  const parts = [
    [count('outdoors'), 'park or green space', 'parks and green spaces'],
    [count('sights'), 'sight', 'sights and museums'],
    [count('food'), 'place to eat or drink', 'places to eat and drink']
  ].filter(([n]) => n > 0).map(([n, one, many]) => `${roundCount(n)} ${n === 1 ? one : many}`)
  if (parts.length === 0) return `Places to explore in ${where}, from ROAM.`
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `${list[0].toUpperCase()}${list.slice(1)} in ${where}.`
}

// ─── HTML ────────────────────────────────────────────────────────
// Visual language is the app's own (docs/BRAND.md): src/index.css tokens,
// the compass mark (/icons/icon.svg) and CategoryIcon medallions.

export const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// JSON inside <script> must not be able to close the tag
const jsonLd = obj => JSON.stringify(obj).replace(/</g, '\\u003c')

const KIND_LABEL = { fast_food: 'takeaway', historic_building: 'historic', theme_park: 'theme park', picnic_site: 'picnic spot', water: 'lake', wood: 'woodland', place_of_worship: 'landmark', manor: 'historic house', archaeological_site: 'archaeology', nature_reserve: 'nature reserve' }
// Sentence case like the app's tags: "Historic house", not "Historic House"
const kindLabel = k => {
  const t = KIND_LABEL[k] || String(k || '').replace(/_/g, ' ')
  return t && t[0].toUpperCase() + t.slice(1)
}

// OSM kind → the app's category medallion (same mapping idea as src/utils/categories.ts)
const KIND_ICON = {
  museum: 'culture', gallery: 'culture', artwork: 'culture',
  castle: 'historic', manor: 'historic', monument: 'historic', ruins: 'historic', memorial: 'historic',
  archaeological_site: 'historic', historic_building: 'historic', place_of_worship: 'historic',
  attraction: 'entertainment', zoo: 'entertainment', theme_park: 'entertainment',
  cafe: 'food', restaurant: 'food', pub: 'food', bar: 'food', fast_food: 'food'
}
const GROUP_ICON = { sights: 'culture', outdoors: 'nature', food: 'food' }
const PIN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>'

// Placeholder tile now; photoScript swaps in a photo if the resolver finds one.
// (No loading="lazy": a detached lazy image never loads, so onload never fires.)
function thumb(p, category) {
  const q = new URLSearchParams({ ...p.photo, name: p.name, category, lat: String(p.lat), lng: String(p.lng) })
  return `<span class="thumb" data-img="${escapeHtml(q.toString())}">${CATEGORY_SVGS[category]}</span>`
}
const photoScript = `<script>document.querySelectorAll('[data-img]').forEach(function(t){fetch('/api/places/image-resolve?'+t.dataset.img).then(function(r){return r.ok?r.json():null}).then(function(d){if(!d||!d.url)return;var i=new Image();i.alt='';i.onload=function(){t.appendChild(i)};i.src=d.url}).catch(function(){})})</script>`

// Light theme = app default; dark = the app's [data-theme="dark"] values
const STYLE = `
  :root {
    --roam-forest: #1a3a2f; --roam-forest-light: #2d5246; --roam-terracotta-light: #e07a5f;
    --roam-sage: #87a28e; --roam-gold: #d4a855;
    --roam-cream: #faf8f5; --roam-paper: #f7f3ed; --roam-parchment: #ede7dc;
    --roam-ink: #2a2520; --roam-ink-light: #4a443d; --roam-ink-muted: #8a847c;
    --surface: #ffffff; --shadow-sm: 0 1px 2px rgba(44, 40, 36, 0.04); --shadow-md: 0 4px 12px rgba(44, 40, 36, 0.08);
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --roam-forest: #6ea58a; --roam-forest-light: #8fbfa3;
      --roam-cream: #0d1b16; --roam-paper: #142822; --roam-parchment: #2a4a3e;
      --roam-ink: #f4ecdc; --roam-ink-light: #d0c5b0; --roam-ink-muted: #8a8275;
      --surface: #1f3a30; --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3); --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.35);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--roam-cream); color: var(--roam-ink); font: 1rem/1.55 'Outfit', system-ui, sans-serif; }
  a { color: var(--roam-forest); }
  a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--roam-gold); outline-offset: 2px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 12px; max-width: 680px; margin: 0 auto; padding: 16px; }
  .brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-family: 'Newsreader', Georgia, serif; font-size: 1.75rem; letter-spacing: -0.04em; color: var(--roam-forest); }
  .brand img { width: 34px; height: 34px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 9999px; background: var(--surface); border: 1px solid var(--roam-parchment); color: var(--roam-ink-light); font-size: 0.875rem; font-weight: 500; text-decoration: none; }
  main { max-width: 680px; margin: 0 auto; padding: 8px 16px 48px; }
  h1 { font-family: 'Newsreader', Georgia, serif; font-weight: 500; font-size: 1.75rem; line-height: 1.2; color: var(--roam-ink); margin: 12px 0 4px; overflow-wrap: anywhere; }
  .where { margin: 0 0 12px; color: var(--roam-ink-muted); font-size: 0.875rem; }
  .lead { margin: 0 0 20px; color: var(--roam-ink-light); max-width: 60ch; }
  /* Same as the app's global .chip (src/index.css) */
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 9999px; background: var(--surface); border: 1.5px solid var(--roam-parchment); color: var(--roam-ink-light); font-size: 0.875rem; font-weight: 500; text-decoration: none; }
  .chip:hover { background: var(--roam-paper); }
  /* One row that scrolls sideways, like the app's filter rows */
  .jump, ul.towns { display: flex; gap: 8px; margin: 0 -16px 8px; padding: 0 16px 2px; list-style: none; overflow-x: auto; scrollbar-width: none; }
  .jump li, ul.towns li { flex: 0 0 auto; }
  .jump svg { width: 18px; height: 18px; }
  h2 { display: flex; align-items: center; gap: 10px; font-family: 'Newsreader', Georgia, serif; font-weight: 500; font-size: 1.375rem; color: var(--roam-ink); margin: 32px 0 12px; scroll-margin-top: 16px; }
  h2 svg { width: 28px; height: 28px; }
  ul.places { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  ul.places a { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--roam-parchment); border-radius: 16px; color: var(--roam-ink); text-decoration: none; box-shadow: var(--shadow-sm); }
  ul.places a:hover { box-shadow: var(--shadow-md); }
  /* Photo thumb with PlaceImage's branded placeholder underneath (src/components/PlaceImage.css) */
  .thumb { position: relative; display: grid; place-items: center; width: 56px; height: 56px; flex: 0 0 56px; border-radius: 8px; overflow: hidden;
    background: radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--roam-gold) 18%, transparent) 0%, transparent 55%),
      radial-gradient(circle at 75% 80%, color-mix(in srgb, var(--roam-forest) 18%, transparent) 0%, transparent 55%),
      linear-gradient(135deg, var(--surface) 0%, var(--roam-paper) 100%); }
  .thumb svg { width: 28px; height: 28px; }
  .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .name { flex: 1; min-width: 0; font-family: 'Newsreader', Georgia, serif; font-size: 1.125rem; font-weight: 500; overflow-wrap: anywhere; }
  .tag { padding: 2px 8px; border-radius: 9999px; background: color-mix(in srgb, var(--roam-sage) 22%, transparent); color: var(--roam-forest); font-size: 0.75rem; white-space: nowrap; }
  .more { color: var(--roam-ink-muted); font-size: 0.875rem; margin: 8px 0 0; }
  .get { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: center; margin: 40px 0 8px; padding: 20px; border-radius: 24px; background: #1a3a2f; color: #fdfcf8; }
  .get img { width: 56px; height: 56px; }
  .get h2 { color: #fdfcf8; margin: 0 0 4px; }
  .get p { margin: 0; color: #d0c5b0; }
  .stores { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 10px; }
  .btn { flex: 1 1 200px; text-align: center; padding: 12px 20px; border-radius: 9999px; font-weight: 600; text-decoration: none; border: 2px solid #fdfcf8; color: #1a3a2f; background: #fdfcf8; }
  .btn.alt { background: transparent; color: #fdfcf8; }
  form.search { display: flex; gap: 8px; }
  form.search input { flex: 1; min-width: 0; padding: 12px 16px; border-radius: 9999px; border: 1px solid var(--roam-parchment); background: var(--surface); color: var(--roam-ink); font: inherit; }
  form.search button { padding: 12px 20px; border: 0; border-radius: 9999px; background: #1a3a2f; color: #fdfcf8; font: inherit; font-weight: 600; cursor: pointer; }
  /* Same row as the app's "Near you" card (.town-near) */
  .near { display: flex; align-items: center; gap: 16px; margin-top: 16px; padding: 16px; background: var(--surface); border: 1px solid var(--roam-parchment); border-radius: 16px; box-shadow: var(--shadow-sm); color: var(--roam-ink); text-decoration: none; }
  .near-icon { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; border-radius: 9999px; background: #1a3a2f; color: var(--roam-gold); }
  .near-text { display: flex; flex-direction: column; flex: 1; }
  .near-text span { color: var(--roam-ink-muted); font-size: 0.875rem; }
  footer { max-width: 680px; margin: 0 auto; text-align: center; color: var(--roam-ink-muted); padding: 24px 16px 40px; font-size: 0.875rem; }
  footer a { color: var(--roam-ink-light); }
  .pill svg, .near svg { flex: 0 0 auto; }
  @media (prefers-color-scheme: dark) {
    /* Literal forest disappears on the dark page; use the dark theme's forest */
    form.search button { background: var(--roam-forest); color: #0d1b16; }
    .near-icon { background: #2a4a3e; }
    .tag { color: var(--roam-ink-light); }
    .get { background: var(--surface); }
  }
  @media (max-width: 480px) { .get { grid-template-columns: 1fr; } }
`

// Anonymous page-view + store-click events so we can see which towns bring
// installs. Only rendered when the PostHog project key is configured.
function analyticsScript(slug) {
  const key = process.env.VITE_POSTHOG_KEY
  if (!key) return ''
  const host = process.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'
  const cfg = jsonLd({ key, host, slug })
  return `<script>(function(c){var id='town_'+Math.random().toString(36).slice(2);
function send(e,p){try{var b=JSON.stringify({api_key:c.key,event:e,distinct_id:id,properties:Object.assign({town:c.slug,$current_url:location.href,$referrer:document.referrer},p)});
navigator.sendBeacon?navigator.sendBeacon(c.host+'/capture/',new Blob([b],{type:'text/plain'})):fetch(c.host+'/capture/',{method:'POST',body:b,keepalive:true})}catch(_){}}
send('town_page_view',{});document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('a[data-store]');if(a)send('town_store_click',{store:a.getAttribute('data-store')})})})(${cfg})</script>`
}

function playLink(slug) {
  const referrer = encodeURIComponent(`utm_source=go-roam.uk&utm_medium=town_page&utm_campaign=${slug}`)
  return `${PLAY_STORE_URL}&referrer=${referrer}`
}

function shell({ title, description, url, body, slug, noindex = false, extraHead = '', extraBody = '' }) {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  ${noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${escapeHtml(url)}" />`}
  <meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${escapeHtml(url)}" />
  <meta name="theme-color" content="#1a3a2f" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:image" content="${SITE}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Outfit:wght@400;500;600&display=swap" />
  <style>${STYLE}</style>
  ${extraHead}
</head>
<body>
  <header>
    <a class="brand" href="/"><img src="/icons/icon.svg" alt="" />ROAM</a>
    <a class="pill" href="/town/near-me" rel="nofollow">${PIN_SVG}Near me</a>
  </header>
  <main>
${body}
  </main>
  <footer><a href="/town">Explore towns</a> &nbsp; <a href="/events">What's on</a> &nbsp; <a href="/get-roam">Get the app</a><br />
  Place data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></footer>
  ${extraBody}
  ${analyticsScript(slug || '')}
</body>
</html>
`
}

function getAppBlock(slug, name) {
  return `    <section class="get">
      <img src="/icons/icon.svg" alt="" />
      <div>
        <h2>${name ? `Plan your weekend in ${escapeHtml(name)}` : 'Plan your weekend with ROAM'}</h2>
        <p>Swipe through every place, save favourites and build a day out in the ROAM app.</p>
      </div>
      <div class="stores">
        <a class="btn" data-store="ios" href="${APP_STORE_URL}">Download on the App Store</a>
        <a class="btn alt" data-store="android" href="${escapeHtml(playLink(slug))}">Get it on Google Play</a>
      </div>
    </section>`
}

function searchForm(value = '') {
  return `    <form class="search" action="/town" method="get" role="search">
      <input name="q" type="search" placeholder="Search any town or city" aria-label="Town or city" value="${escapeHtml(value)}" required />
      <button type="submit">Explore</button>
    </form>`
}

function featuredList(excludeSlug) {
  return `    <ul class="towns">
${TOWNS.filter(t => t.slug !== excludeSlug).map(t => `      <li><a class="chip" href="/town/${t.slug}">${escapeHtml(t.name)}</a></li>`).join('\n')}
    </ul>`
}

export function renderTownPage(town, grouped) {
  const url = `${SITE}/town/${town.slug}`
  const description = describeTown(town, grouped)
  const where = [town.region && town.region !== town.name ? town.region : null, town.country].filter(Boolean).join(', ')
  const jump = grouped.groups.length > 1
    ? `    <ul class="jump">
${grouped.groups.map(g => `      <li><a class="chip" href="#${g.key}">${CATEGORY_SVGS[GROUP_ICON[g.key]]}${escapeHtml(g.title)}</a></li>`).join('\n')}
    </ul>\n`
    : ''
  const sections = grouped.groups.map(g => `    <h2 id="${g.key}">${CATEGORY_SVGS[GROUP_ICON[g.key]]}${escapeHtml(g.title)}</h2>
    <ul class="places">
${g.places.map(p => `      <li><a href="/place/${encodeURIComponent(p.id)}">${thumb(p, KIND_ICON[p.kind] || GROUP_ICON[g.key])}<span class="name">${escapeHtml(p.name)}</span><span class="tag">${escapeHtml(kindLabel(p.kind))}</span></a></li>`).join('\n')}
    </ul>${g.total > g.places.length ? `\n    <p class="more">${g.total - g.places.length} more in the app</p>` : ''}`).join('\n')

  const structured = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ROAM', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Towns', item: `${SITE}/town` },
          { '@type': 'ListItem', position: 3, name: town.name, item: url }
        ]
      },
      {
        '@type': 'ItemList',
        name: `Things to do in ${town.name}`,
        itemListElement: grouped.groups.flatMap(g => g.places).map((p, i) => ({
          '@type': 'ListItem', position: i + 1, name: p.name, url: `${SITE}/place/${encodeURIComponent(p.id)}`
        }))
      }
    ]
  }

  const body = `    <h1>${escapeHtml(town.name)}</h1>
    ${where ? `<p class="where">${escapeHtml(where)}</p>` : ''}
    <p class="lead">${escapeHtml(description)}</p>
${jump}${sections || '    <p class="lead">Places didn\'t load this time. Refresh in a minute, or open ROAM to explore what\'s around.</p>'}
${getAppBlock(town.slug, town.name)}
    <h2>Explore another town</h2>
${searchForm()}
    <h2>Popular towns</h2>
${featuredList(town.slug)}`

  return shell({
    title: `Things to do in ${town.name}: best places for a weekend | ROAM`,
    description,
    url,
    body,
    slug: town.slug,
    // A page with no places is thin content; keep it out of the index until it has data
    noindex: grouped.total === 0,
    extraHead: `<script type="application/ld+json">${jsonLd(structured)}</script>`,
    extraBody: photoScript
  })
}

export function renderHub({ query = '', notFound = false, unavailable = false } = {}) {
  const heading = unavailable ? 'Town search is busy' : notFound ? 'No town by that name' : 'Explore a town'
  const lead = unavailable
    ? 'The town lookup is busy right now. Try again in a minute, or pick a popular town below.'
    : notFound
      ? `Nothing matched “${escapeHtml(query)}”. Try the full name, or add the county or country.`
      : 'Parks, sights and places to eat in any town or city. Search for one, or see what\'s near you.'
  const body = `    <h1>${heading}</h1>
    <p class="lead">${lead}</p>
${searchForm(query)}
    <a class="near" href="/town/near-me" rel="nofollow"><span class="near-icon">${PIN_SVG}</span><span class="near-text"><strong>Near you</strong><span>What's around where you are now</span></span></a>
    <h2>Popular towns</h2>
${featuredList()}
${getAppBlock('hub', null)}`
  return shell({
    title: unavailable ? 'Try again shortly | ROAM' : notFound ? 'Town not found | ROAM' : 'Explore any town: things to do near you | ROAM',
    description: 'Find parks, sights and places to eat in any town or city, then plan your weekend with ROAM.',
    url: `${SITE}/town`,
    body,
    slug: unavailable ? 'unavailable' : notFound ? 'not-found' : 'hub',
    noindex: notFound || unavailable
  })
}
