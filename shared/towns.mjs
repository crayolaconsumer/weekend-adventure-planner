// Single source of truth for the town landing pages: slug, name,
// centre lat/lng, one honest sentence. Imported by scripts/prerender-towns.mjs
// (build) and api/sitemap.js (runtime).
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
export { TOWNS }
