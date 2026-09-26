/**
 * Periodic eval for the live town pages (api/town.js). Not a gate test:
 * it hits real Nominatim + Overpass through a deployment, so it is slow
 * and can flake when a mirror is down. Run before shipping and after
 * changing the town query or ranking.
 *
 *   node scripts/eval-towns.mjs                      # production
 *   node scripts/eval-towns.mjs https://<preview-url>
 *   BYPASS=<token> node scripts/eval-towns.mjs <protected-preview-url>
 *
 * Each case must return 200, name the right town, list >= MIN_PLACES
 * places, carry the install hooks, and (where given) include a landmark
 * a local would expect. Passes when >= PASS_RATE of cases pass.
 */

const BASE = (process.argv[2] || 'https://www.go-roam.uk').replace(/\/$/, '')
const MIN_PLACES = 12
const PASS_RATE = 0.9

// [slug, expected h1, landmark that must appear (or null)]
const CASES = [
  ['hatfield', 'Hatfield', 'Hatfield House'],
  ['houghton-regis', 'Houghton Regis', 'Houghton Hall Park'],
  ['london', 'London', null],
  ['york', 'York', 'York Minster'],
  ['bath', 'Bath', null],
  ['edinburgh', 'Edinburgh', 'Edinburgh Castle'],
  ['cardiff', 'Cardiff', 'Cardiff Castle'],
  ['paris', 'Paris', 'Tour Eiffel'],
  ['rome', 'Rome', null],
  ['new-york', 'New York', 'Statue of Liberty'],
  ['san-francisco', 'San Francisco', null],
  ['kyoto', 'Kyoto', 'Kiyomizu-dera'],
  ['sydney', 'Sydney', null],
  ['sao-paulo', 'São Paulo', null],
  ['cape-town', 'Cape Town', null],
  ['st-albans', 'St Albans', null]
]

const headers = { 'User-Agent': 'ROAM town eval' }
if (process.env.BYPASS) headers['x-vercel-protection-bypass'] = process.env.BYPASS

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

async function check([slug, name, landmark]) {
  const started = Date.now()
  const res = await fetch(`${BASE}/town/${slug}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(65000) })
  const html = decode(await res.text())
  const places = [...html.matchAll(/<span class="name">([^<]+)<\/span>/g)].map(m => m[1])
  const problems = []
  if (res.status !== 200) problems.push(`status ${res.status}`)
  if (!html.includes(`<h1>${name}</h1>`)) problems.push(`h1 is not "${name}"`)
  if (places.length < MIN_PLACES) problems.push(`${places.length} places`)
  if (landmark && !places.some(p => p.includes(landmark))) problems.push(`missing ${landmark}`)
  if (!html.includes('name="apple-itunes-app"') || !html.includes('data-store="android"')) problems.push('no install hooks')
  if (!html.includes('OpenStreetMap contributors')) problems.push('no OSM attribution')
  return { slug, ok: problems.length === 0, ms: Date.now() - started, places: places.length, cache: res.headers.get('x-vercel-cache'), problems }
}

console.log(`Town eval against ${BASE}\n`)
const results = []
for (const c of CASES) {
  let r
  try { r = await check(c) } catch (err) { r = { slug: c[0], ok: false, ms: 0, places: 0, problems: [err.message] } }
  results.push(r)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.slug.padEnd(15)} ${String(r.places).padStart(2)} places  ${String(r.ms).padStart(6)}ms  ${r.cache || ''}  ${r.problems.join('; ')}`)
}
const passed = results.filter(r => r.ok).length
const rate = passed / results.length
console.log(`\n${passed}/${results.length} passed (${Math.round(rate * 100)}%, threshold ${PASS_RATE * 100}%)`)
process.exit(rate >= PASS_RATE ? 0 : 1)
