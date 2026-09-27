/**
 * Regenerates shared/worldTowns.mjs: shipped records for ~400 international
 * cities people search "things to do in X" for in English, so their town
 * pages (and the sitemap crawl of them) never call Nominatim at request time.
 *
 * Each curated name is geocoded ONCE (Nominatim, 1.1s apart, cached in
 * /tmp/world-towns/cache.json so reruns cost nothing). Slugs never collide
 * with a UK slug: the UK town keeps the bare slug and the world city is
 * qualified, by state/province in the US and Canada ("london-ontario"),
 * by country elsewhere ("perth-australia").
 *
 *   node scripts/gen-world-towns.mjs        # ~8 min cold, seconds when cached
 *   tail -f /tmp/world-towns/progress.log
 */
import { writeFileSync, mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { slugify, isValidSlug } from '../shared/townSlug.mjs'
import { UK_TOWN_SLUGS } from '../shared/ukTowns.mjs'

const OUT = new URL('../shared/worldTowns.mjs', import.meta.url)
const DIR = '/tmp/world-towns'
const CACHE = `${DIR}/cache.json`
const LOG = `${DIR}/progress.log`
const UA = 'ROAM/1.0 (+https://www.go-roam.uk; support@extrastaff.com)'
const SPACING_MS = 1100
mkdirSync(DIR, { recursive: true })
const log = msg => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); appendFileSync(LOG, line + '\n') }

// A name, or [name, { q: geocoder query, qualify: always add the state/country, type: Nominatim featureType,
//   osm: the country code OSM files it under, country: the name to show instead of OSM's }]
// qualify Newcastle: bare /town/newcastle is Newcastle upon Tyne to UK searchers
const CITIES = {
  // United States: every city over ~500k, plus the big tourist ones
  us: ['New York', 'Los Angeles', 'Chicago', ['Houston', { q: 'Houston, Texas' }], 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego',
    ['Dallas', { q: 'Dallas, Texas' }], 'San Jose', ['Austin', { q: 'Austin, Texas' }], ['Jacksonville', { q: 'Jacksonville, Florida' }], 'Fort Worth',
    ['Columbus', { q: 'Columbus, Ohio' }], 'Indianapolis', ['Charlotte', { q: 'Charlotte, North Carolina' }], 'San Francisco', ['Seattle', { q: 'Seattle, Washington' }],
    ['Denver', { q: 'Denver, Colorado' }], ['Washington, DC', { q: 'Washington, District of Columbia' }], ['Nashville', { q: 'Nashville, Tennessee' }],
    'Oklahoma City', 'El Paso', ['Boston', { q: 'Boston, Massachusetts' }], ['Portland', { q: 'Portland, Oregon' }], 'Las Vegas', ['Detroit', { q: 'Detroit, Michigan' }],
    ['Memphis', { q: 'Memphis, Tennessee' }], ['Louisville', { q: 'Louisville, Kentucky' }], ['Baltimore', { q: 'Baltimore, Maryland' }], 'Milwaukee',
    'Albuquerque', 'Tucson', 'Fresno', 'Sacramento', ['Mesa', { q: 'Mesa, Arizona' }], ['Kansas City', { q: 'Kansas City, Missouri' }], ['Atlanta', { q: 'Atlanta, Georgia' }],
    'Omaha', 'Colorado Springs', ['Raleigh', { q: 'Raleigh, North Carolina' }], ['Miami', { q: 'Miami, Florida' }], 'New Orleans', 'Honolulu',
    ['Orlando', { q: 'Orlando, Florida' }], 'Minneapolis', ['Pittsburgh', { q: 'Pittsburgh, Pennsylvania' }], ['St Louis', { q: 'St. Louis, Missouri' }],
    'Salt Lake City', ['Tampa', { q: 'Tampa, Florida' }], ['Charleston', { q: 'Charleston, South Carolina' }], ['Savannah', { q: 'Savannah, Georgia' }],
    'Key West', ['Santa Fe', { q: 'Santa Fe, New Mexico' }], 'Sedona', 'Palm Springs', 'Scottsdale', ['Anchorage', { q: 'Anchorage, Alaska' }],
    'Miami Beach', 'Santa Barbara', 'Napa'],
  ca: ['Toronto', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton', 'Winnipeg', 'Mississauga', 'Vancouver', 'Brampton',
    ['Hamilton', { q: 'Hamilton, Ontario' }], ['Quebec City', { q: 'Québec' }], ['Surrey', { q: 'Surrey, British Columbia', qualify: true }],
    ['Victoria', { q: 'Victoria, British Columbia' }], ['Halifax', { q: 'Halifax, Nova Scotia' }], ['London', { q: 'London, Ontario' }],
    ['Niagara Falls', { q: 'Niagara Falls, Ontario' }], 'Banff', 'Whistler', 'Kelowna', "St. John's"],
  au: ['Sydney', 'Melbourne', 'Brisbane', ['Perth', { q: 'Perth, Western Australia' }], 'Adelaide', 'Gold Coast', 'Canberra',
    ['Newcastle', { q: 'Newcastle, New South Wales', qualify: true }], 'Hobart', 'Darwin', 'Cairns', 'Byron Bay', 'Geelong'],
  nz: ['Auckland', 'Wellington', 'Christchurch', ['Hamilton', { q: 'Hamilton, Waikato' }], 'Queenstown', 'Rotorua', 'Dunedin', 'Tauranga', 'Napier', ['Nelson', { q: 'Nelson, New Zealand' }]],
  // Ireland: every town over ~20k, plus the tourist ones
  ie: ['Dublin', 'Cork', 'Limerick', 'Galway', 'Waterford', 'Drogheda', 'Dundalk', 'Swords', 'Bray', 'Navan', 'Kilkenny', 'Ennis',
    'Carlow', 'Tralee', ['Newbridge', { q: 'Newbridge, County Kildare' }], 'Portlaoise', 'Balbriggan', 'Naas', 'Athlone', 'Mullingar', 'Celbridge',
    'Wexford', 'Letterkenny', 'Sligo', 'Greystones', 'Clonmel', 'Killarney', 'Kinsale', 'Westport', 'Dingle', 'Malahide', 'Howth'],
  // Europe's most-searched city breaks
  fr: ['Paris', 'Nice', 'Lyon', 'Marseille', 'Bordeaux', 'Strasbourg', 'Toulouse', 'Cannes', 'Montpellier', 'Lille', 'Avignon', 'Annecy',
    ['Chamonix', { q: 'Chamonix-Mont-Blanc' }], 'Biarritz', 'Nantes', 'Colmar', 'Antibes', 'Saint-Tropez', 'Carcassonne', 'Rouen', 'Reims', 'Aix-en-Provence'],
  es: ['Barcelona', 'Madrid', 'Seville', 'Valencia', 'Granada', ['Málaga', { type: 'city' }], ['Palma', { q: 'Palma, Balearic Islands' }], ['Ibiza', { q: 'Eivissa' }], 'Bilbao',
    ['San Sebastián', { q: 'Donostia-San Sebastián' }], 'Marbella', 'Benidorm', 'Alicante', 'Córdoba', 'Toledo', 'Salamanca', 'Girona', 'Sitges',
    'Las Palmas de Gran Canaria', 'Santa Cruz de Tenerife', 'Nerja', 'Ronda', 'Cádiz', 'Santiago de Compostela', 'Zaragoza'],
  it: ['Rome', 'Florence', 'Venice', 'Milan', 'Naples', 'Verona', 'Bologna', 'Pisa', 'Siena', 'Turin', 'Genoa', 'Palermo', 'Catania', 'Sorrento',
    'Amalfi', 'Positano', 'Como', 'Lucca', 'Bergamo', 'Taormina', 'Bari', 'Trieste', 'Lecce', 'Matera'],
  pt: ['Lisbon', 'Porto', 'Faro', 'Albufeira', 'Lagos', 'Funchal', 'Sintra', 'Cascais', 'Coimbra', 'Évora'],
  de: ['Berlin', 'Munich', 'Hamburg', ['Frankfurt', { q: 'Frankfurt am Main' }], 'Cologne', 'Düsseldorf', 'Stuttgart', 'Dresden', 'Leipzig', 'Nuremberg', 'Heidelberg'],
  nl: ['Amsterdam', 'Rotterdam', ['The Hague', { q: 'Den Haag' }], 'Utrecht', 'Delft', 'Haarlem', 'Maastricht'],
  be: ['Brussels', ['Bruges', { q: 'Brugge' }], ['Antwerp', { q: 'Antwerpen' }], ['Ghent', { q: 'Gent' }]],
  lu: ['Luxembourg'],
  ch: ['Zurich', 'Geneva', 'Lucerne', 'Interlaken', 'Bern', 'Basel', 'Lausanne', 'Zermatt'],
  at: ['Vienna', 'Salzburg', 'Innsbruck', 'Hallstatt', 'Graz'],
  cz: ['Prague', 'Český Krumlov', 'Brno'],
  hu: ['Budapest'],
  pl: ['Warsaw', 'Kraków', 'Gdańsk', 'Wrocław'],
  sk: ['Bratislava'],
  si: ['Ljubljana', 'Bled'],
  hr: ['Dubrovnik', 'Split', 'Zagreb', 'Zadar', 'Hvar', 'Rovinj'],
  me: ['Kotor', 'Budva'],
  ba: ['Sarajevo', 'Mostar'],
  rs: ['Belgrade'],
  ro: ['Bucharest', 'Brașov'],
  bg: ['Sofia'],
  al: ['Tirana'],
  gr: ['Athens', 'Thessaloniki', 'Mykonos', 'Chania', 'Heraklion', 'Rhodes', ['Corfu', { q: 'Kerkyra' }]],
  cy: ['Paphos', 'Limassol', 'Ayia Napa', 'Larnaca', 'Nicosia'],
  mt: ['Valletta', 'Sliema'],
  tr: ['Istanbul', 'Antalya', 'Bodrum', 'Izmir'],
  dk: ['Copenhagen', 'Aarhus'],
  se: ['Stockholm', 'Gothenburg', 'Malmö'],
  no: ['Oslo', 'Bergen', 'Tromsø'],
  fi: ['Helsinki', 'Rovaniemi'],
  is: ['Reykjavík'],
  ee: ['Tallinn'],
  lv: ['Riga'],
  lt: ['Vilnius'],
  mc: ['Monaco'],
  // The rest of the world's big city breaks
  ae: ['Dubai', 'Abu Dhabi'],
  qa: ['Doha'],
  om: ['Muscat'],
  sg: ['Singapore'],
  jp: ['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima', 'Nara', 'Sapporo', 'Fukuoka'],
  kr: ['Seoul', 'Busan'],
  th: ['Bangkok', 'Phuket', 'Chiang Mai', ['Krabi', { q: 'Krabi Town' }], 'Pattaya'],
  my: ['Kuala Lumpur', ['Penang', { q: 'George Town, Penang' }]],
  vn: ['Hanoi', 'Ho Chi Minh City', 'Da Nang', 'Hoi An'],
  kh: ['Siem Reap', 'Phnom Penh'],
  la: ['Luang Prabang'],
  ph: ['Manila'],
  tw: ['Taipei'],
  cn: ['Shanghai', 'Beijing'],
  // OSM files Hong Kong under China; people (and the page) treat it as its own place
  hk: [['Hong Kong', { osm: 'cn', country: 'Hong Kong' }]],
  in: [['Delhi', { q: 'New Delhi' }], 'Mumbai', 'Jaipur', 'Agra'],
  np: ['Kathmandu'],
  lk: ['Colombo'],
  id: ['Ubud', 'Jakarta'],
  za: ['Cape Town', 'Johannesburg', 'Durban'],
  ma: ['Marrakech', 'Fes', 'Casablanca'],
  eg: ['Cairo', 'Luxor'],
  ke: ['Nairobi'],
  tz: [['Zanzibar', { q: 'Zanzibar City' }]],
  il: ['Tel Aviv', 'Jerusalem'],
  jo: ['Amman'],
  mx: [['Mexico City', { q: 'Ciudad de México' }], 'Cancún', 'Tulum', 'Playa del Carmen', ['Oaxaca', { q: 'Oaxaca City' }], 'Guadalajara'],
  cu: ['Havana'],
  bs: ['Nassau'],
  br: ['Rio de Janeiro', 'São Paulo'],
  ar: ['Buenos Aires'],
  pe: ['Lima', 'Cusco'],
  cl: ['Santiago'],
  co: ['Bogotá', 'Cartagena', 'Medellín']
}

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const sleep = ms => new Promise(r => setTimeout(r, ms))
let lastCall = 0

// A province or county result puts the page's 3km places box at its centroid,
// tens of km from the city (Pisa, Phuket, Napa did), so a town-type result wins
const PLACE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood'])
const pick = results => results.find(r => PLACE_TYPES.has(r.addresstype)) || results[0] || null

async function geocode(q, cc, type = 'settlement') {
  const key = `5:${cc}:${q}${type === 'settlement' ? '' : `:${type}`}`
  if (key in cache) return cache[key]
  // First runs cached the top result only; keep it when it's already a town
  const old = cache[`${cc}:${q}`]
  if (type === 'settlement' && old && PLACE_TYPES.has(old.addresstype)) return old
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=${cc}&format=jsonv2&limit=5&addressdetails=1&featureType=${type}&accept-language=en`
  for (let attempt = 1; ; attempt++) {
    await sleep(Math.max(0, lastCall + SPACING_MS - Date.now()))
    lastCall = Date.now()
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const results = await res.json()
      cache[key] = pick(results)
      writeFileSync(CACHE, JSON.stringify(cache))
      return cache[key]
    } catch (err) {
      if (attempt >= 4) throw err
      log(`retry ${attempt} ${key}: ${err.message}`)
      await sleep(5000 * attempt)
    }
  }
}

const entries = Object.entries(CITIES).flatMap(([cc, list]) =>
  list.map(e => typeof e === 'string' ? { cc, name: e, q: e } : { cc, name: e[0], q: e[1].q || e[0], ...e[1] }))
const taken = new Set(UK_TOWN_SLUGS)
const out = []
const started = Date.now()
let missing = 0

for (const [i, e] of entries.entries()) {
  const osm = e.osm || e.cc
  const r = await geocode(e.q, osm, e.type)
  const a = r?.address || {}
  if (!r || a.country_code !== osm) {
    missing++
    log(`MISS ${e.cc} ${e.name} (${r ? `got ${a.country_code}` : 'no result'})`)
    continue
  }
  // Irish counties read better than provinces ("County Cork", not "Munster")
  const region = (e.cc === 'ie' ? a.county || a.state : a.state || a.region || a.county) || null
  const bare = slugify(e.name)
  const country = e.country || a.country
  const qualifier = e.cc === 'us' || e.cc === 'ca' ? region : country
  const slug = e.qualify || taken.has(bare) ? slugify(`${e.name} ${qualifier}`) : bare
  if (!isValidSlug(slug) || taken.has(slug)) {
    missing++
    log(`SKIP ${e.cc} ${e.name}: slug ${slug} invalid or taken`)
    continue
  }
  taken.add(slug)
  if (slug !== bare) log(`qualified ${e.name} → ${slug}`)
  if (normalise(r.name) !== normalise(e.name)) log(`note ${slug}: geocoder calls it "${r.name}" (importance ${r.importance?.toFixed(2)})`)
  out.push({ slug, name: e.name, region: region === e.name ? null : region, country, countryCode: e.cc, lat: round(r.lat), lng: round(r.lon) })
  if ((i + 1) % 25 === 0) {
    const rate = (i + 1) / Math.max(1, (Date.now() - started) / 1000)
    log(`world-towns ${Math.round((i + 1) / entries.length * 100)}% ${i + 1}/${entries.length}, ETA ${Math.round((entries.length - i - 1) / rate)}s, kept ${out.length}, missing ${missing}`)
  }
}

function round(v) { return Math.round(parseFloat(v) * 1e5) / 1e5 }
function normalise(s) { return slugify(s || '') }

// Two names landing on one point means a query found the wrong place
for (const [i, a] of out.entries()) {
  for (const b of out.slice(i + 1)) {
    if (Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lng - b.lng) < 0.02) log(`DUPLICATE? ${a.slug} and ${b.slug}`)
  }
}
if (out.length < entries.length * 0.9) throw new Error(`Only ${out.length}/${entries.length} geocoded; not writing a partial list`)
out.sort((a, b) => a.slug.localeCompare(b.slug))
writeFileSync(OUT, `// GENERATED by scripts/gen-world-towns.mjs (Nominatim, one lookup per city, cached).
// International cities whose /town/<slug> pages resolve without the geocoder
// and are listed in the sitemap. Slugs never collide with shared/ukTowns.mjs.
// Do not edit by hand. ${out.length} towns.
export const WORLD_TOWNS = [
${out.map(t => `  ${JSON.stringify(t)}`).join(',\n')}
]
export const WORLD_TOWN_SLUGS = WORLD_TOWNS.map(t => t.slug)
`)
log(`done: ${out.length} towns written, ${missing} missing`)
