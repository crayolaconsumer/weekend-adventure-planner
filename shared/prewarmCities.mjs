// Cities the nightly Overpass prewarm (api/cron/prewarm-overpass.js) keeps warm in KV, so a
// first Discover open near one of these centres is a cache hit instead of a 20-50 s public
// Overpass call. Reviewed list: the world's most-visited and most-populous cities, every
// continent. GB and Ireland are left out: the POI DB answers there (poiDbPct 100, 26 Oct).
//
// Coordinates come from shared/worldTowns.mjs (Nominatim, generated) so the warmed tile is the
// town page's own centre. EXTRA_CITIES are megacities that list lacks, hand-entered to ~1 km.
//
// The warm only helps visitors whose snapped bbox centre lands in the same 0.01 degree cell
// (api/lib/bboxSnap.js), i.e. near the centre. Everyone else's first open is answered by the
// stale copy or the GeoApify fallback in api/places/overpass/nearby.js.

import { WORLD_TOWNS } from './worldTowns.mjs'

const WORLD_SLUGS = [
  // Europe
  'paris', 'nice', 'lyon', 'marseille', 'bordeaux', 'strasbourg', 'toulouse',
  'berlin', 'munich', 'hamburg', 'frankfurt', 'cologne',
  'madrid', 'barcelona', 'seville', 'valencia', 'malaga', 'granada', 'palma', 'bilbao',
  'rome', 'milan', 'venice', 'florence', 'naples',
  'amsterdam', 'rotterdam', 'brussels', 'bruges', 'antwerp', 'luxembourg',
  'lisbon', 'porto', 'vienna', 'salzburg', 'zurich', 'geneva', 'lucerne',
  'prague', 'budapest', 'krakow', 'warsaw', 'bratislava', 'ljubljana',
  'copenhagen', 'stockholm', 'oslo', 'helsinki', 'reykjavik', 'tallinn', 'riga', 'vilnius',
  'athens', 'thessaloniki', 'dubrovnik', 'split', 'zagreb', 'belgrade', 'sofia', 'bucharest',
  'istanbul', 'antalya', 'valletta', 'monaco', 'limassol',
  // North America
  'new-york', 'los-angeles', 'chicago', 'san-francisco', 'las-vegas', 'miami', 'orlando',
  'washington-dc', 'boston', 'seattle', 'honolulu', 'new-orleans', 'san-diego', 'houston',
  'dallas', 'atlanta', 'philadelphia', 'austin', 'nashville', 'denver', 'phoenix',
  'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa', 'quebec-city', 'niagara-falls',
  'mexico-city', 'cancun', 'guadalajara', 'havana',
  // South America
  'sao-paulo', 'rio-de-janeiro', 'buenos-aires', 'santiago', 'lima', 'cusco', 'bogota',
  'medellin', 'cartagena',
  // Asia
  'tokyo', 'kyoto', 'osaka', 'seoul', 'busan', 'beijing', 'shanghai', 'hong-kong', 'taipei',
  'singapore', 'bangkok', 'phuket', 'chiang-mai', 'kuala-lumpur', 'penang', 'jakarta', 'ubud',
  'manila', 'hanoi', 'ho-chi-minh-city', 'siem-reap', 'delhi', 'mumbai', 'agra', 'jaipur',
  'kathmandu', 'colombo',
  // Middle East
  'dubai', 'abu-dhabi', 'doha', 'tel-aviv', 'jerusalem', 'amman',
  // Africa
  'cape-town', 'johannesburg', 'durban', 'cairo', 'marrakech', 'casablanca', 'nairobi',
  // Oceania
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'gold-coast', 'auckland',
  'queenstown', 'wellington',
]

const EXTRA_CITIES = [
  { name: 'Shenzhen', lat: 22.5431, lng: 114.0579 },
  { name: 'Guangzhou', lat: 23.1291, lng: 113.2644 },
  { name: 'Chengdu', lat: 30.5728, lng: 104.0668 },
  { name: "Xi'an", lat: 34.3416, lng: 108.9398 },
  { name: 'Hangzhou', lat: 30.2741, lng: 120.1551 },
  { name: 'Bangalore', lat: 12.9716, lng: 77.5946 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Karachi', lat: 24.8607, lng: 67.0011 },
  { name: 'Lahore', lat: 31.5204, lng: 74.3587 },
  { name: 'Dhaka', lat: 23.8103, lng: 90.4125 },
  { name: 'Almaty', lat: 43.2220, lng: 76.8512 },
  { name: 'Tashkent', lat: 41.2995, lng: 69.2401 },
  { name: 'Tbilisi', lat: 41.7151, lng: 44.8271 },
  { name: 'Baku', lat: 40.4093, lng: 49.8671 },
  { name: 'Moscow', lat: 55.7558, lng: 37.6173 },
  { name: 'Tehran', lat: 35.6892, lng: 51.3890 },
  { name: 'Riyadh', lat: 24.7136, lng: 46.6753 },
  { name: 'Jeddah', lat: 21.4858, lng: 39.1925 },
  { name: 'Kuwait City', lat: 29.3759, lng: 47.9774 },
  { name: 'Lagos', lat: 6.4550, lng: 3.3941 },
  { name: 'Accra', lat: 5.6037, lng: -0.1870 },
  { name: 'Addis Ababa', lat: 9.0054, lng: 38.7636 },
  { name: 'Dar es Salaam', lat: -6.7924, lng: 39.2083 },
  { name: 'Kinshasa', lat: -4.4419, lng: 15.2663 },
  { name: 'Tunis', lat: 36.8065, lng: 10.1815 },
  { name: 'Montevideo', lat: -34.9011, lng: -56.1645 },
  { name: 'Quito', lat: -0.1807, lng: -78.4678 },
  { name: 'Panama City', lat: 8.9824, lng: -79.5199 },
  { name: 'San Juan', lat: 18.4655, lng: -66.1057 },
]

// The 2026 launch set, warmed at every Discover radius since before this list existed:
// kept that way so their larger-radius decks stay warm. The rest warm the first-open query only.
export const ALL_RADII_SLUGS = new Set([
  'paris', 'berlin', 'madrid', 'rome', 'amsterdam', 'lisbon',
  'new-york', 'los-angeles', 'chicago', 'toronto', 'mexico-city', 'sao-paulo', 'buenos-aires',
  'tokyo', 'seoul', 'singapore', 'hong-kong', 'bangkok', 'mumbai', 'dubai',
  'sydney', 'melbourne', 'auckland', 'cape-town',
])

const bySlug = new Map(WORLD_TOWNS.map(t => [t.slug, t]))

export const PREWARM_CITIES = [
  ...WORLD_SLUGS.map(slug => {
    const t = bySlug.get(slug)
    if (!t) throw new Error(`prewarmCities: ${slug} is not in shared/worldTowns.mjs`)
    return { slug, name: t.name, lat: t.lat, lng: t.lng }
  }),
  ...EXTRA_CITIES.map(c => ({ slug: null, ...c })),
]
