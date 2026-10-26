// Worldwide smoke test: does ROAM work where it's offered? For a spread of cities on
// every continent, asks production (or BASE) for Discover places, the town guide,
// weather and events, and prints one line per city.
// Gentle by design: one city at a time, a pause between requests (outside Great
// Britain these reach public Overpass through our proxy; never turn this into a load test).
// Usage: node scripts/smoke-worldwide.mjs [BASE]   (default https://www.go-roam.uk)
//        ONLY=town node scripts/smoke-worldwide.mjs   (just one check: places | town | weather | events)
//        SMOKE_COOKIE='_vercel_jwt=…' node scripts/smoke-worldwide.mjs <preview url>   (protected preview)
import { buildDiscoverOverpassQuery } from '../shared/overpassQuery.js'

const BASE = process.argv[2] || 'https://www.go-roam.uk'
const PAUSE_MS = 8000
const ONLY = process.env.ONLY || ''
// SMOKE_COOKIE='_vercel_jwt=...' reaches a protected preview (cookie from its _vercel_share link)
const H = process.env.SMOKE_COOKIE ? { cookie: process.env.SMOKE_COOKIE } : {}
const CITIES = [
  { name: 'Lisbon', slug: 'lisbon', country: 'PT', lat: 38.7105, lng: -9.1366 },
  { name: 'New York', slug: 'new-york', country: 'US', lat: 40.7580, lng: -73.9855 },
  { name: 'Sydney', slug: 'sydney', country: 'AU', lat: -33.8688, lng: 151.2093 },
  { name: 'Tokyo', slug: 'tokyo', country: 'JP', lat: 35.6895, lng: 139.6917 },
  { name: 'Cape Town', slug: 'cape-town', country: 'ZA', lat: -33.9249, lng: 18.4241 },
  { name: 'Mexico City', slug: 'mexico-city', country: 'MX', lat: 19.4326, lng: -99.1332 },
]
const sleep = ms => new Promise(r => setTimeout(r, ms))
const timed = async (fn) => { const t = Date.now(); try { return { ...(await fn()), ms: Date.now() - t } } catch (e) { return { error: e.message, ms: Date.now() - t } } }

async function places(c) {
  const query = buildDiscoverOverpassQuery(c.lat, c.lng, 5000, null).query
  const r = await fetch(`${BASE}/api/places/overpass/nearby`, { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify({ query }) })
  const j = r.ok ? await r.json() : null
  return { status: r.status, n: j?.elements?.length ?? 0 }
}
// The guide itself, not just a 200: count the places the page lists (a 200 can be an empty guide)
const MIN_TOWN_PLACES = 8
async function town(c) {
  const r = await fetch(`${BASE}/town/${c.slug}`, { headers: H })
  const html = r.ok ? await r.text() : ''
  const places = [...html.matchAll(/<ul class="places">([\s\S]*?)<\/ul>/g)].reduce((n, m) => n + (m[1].match(/<li\b/g) || []).length, 0)
  return { status: r.status, places }
}
async function weather(c) {
  const r = await fetch(`${BASE}/api/weather?lat=${c.lat}&lng=${c.lng}`, { headers: H })
  return { status: r.status, ok: r.ok }
}
async function events(c, withCountry) {
  const q = new URLSearchParams({ lat: c.lat.toFixed(2), lng: c.lng.toFixed(2), radius: '30', page: '0', ...(withCountry ? { country: c.country } : {}) })
  const r = await fetch(`${BASE}/api/events/ticketmaster?${q}`, { redirect: 'follow', headers: H })
  const j = r.ok ? await r.json().catch(() => null) : null
  return { status: r.status, n: j?.events?.length ?? j?._embedded?.events?.length ?? 0 }
}

console.log(`base ${BASE}`)
const rows = []
for (const c of CITIES) {
  const run = async (name, fn) => { if (ONLY && ONLY !== name) return null; const r = await timed(fn); await sleep(PAUSE_MS); return r }
  const p = await run('places', () => places(c))
  const t = await run('town', () => town(c))
  const w = await run('weather', () => weather(c))
  const e = await run('events', () => events(c, false))
  const row = { city: c.name,
    ...(p && { places: p.error || `${p.status} n=${p.n} ${p.ms}ms` }),
    ...(t && { town: t.error || `${t.status} places=${t.places}` }),
    ...(w && { weather: w.error || `${w.status}` }),
    ...(e && { events: e.error || `${e.status} n=${e.n}` }) }
  rows.push(row)
  console.log(JSON.stringify(row))
}
const townOk = t => { const m = /^200 places=(\d+)/.exec(t); return !!m && Number(m[1]) >= MIN_TOWN_PLACES }
const bad = rows.filter(r => (r.places !== undefined && !/^200 n=[1-9]/.test(r.places)) || (r.town !== undefined && !townOk(r.town)) || (r.weather !== undefined && r.weather !== '200'))
console.log(bad.length ? `PROBLEMS in ${bad.map(r => r.city).join(', ')}` : 'places, town guides and weather OK everywhere')
