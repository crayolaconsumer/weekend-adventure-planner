// Featured towns: the sitemap and the "Popular towns" links on every town
// page. Any town works at /town/<slug>; these just get a curated sentence.
// No coordinates here on purpose: api/lib/towns.js geocodes every slug, so
// a hand-typed lat/lng can't send a page to the wrong town again (Hatfield
// and Houghton Regis both did, pointing at Witney and Bedford).
// Imported by api/lib/towns.js and api/sitemap.js.
const TOWNS = [
  { slug: 'hatfield', name: 'Hatfield', blurb: 'Hatfield House and its park, Old Hatfield\'s streets and green space around the university town.' },
  { slug: 'houghton-regis', name: 'Houghton Regis', blurb: 'Houghton Hall Park, the old village green and chalk downland on the edge of the Chilterns.' },
  { slug: 'birmingham', name: 'Birmingham', blurb: 'Parks, food markets and live music across one of England\'s biggest cities.' },
  { slug: 'leeds', name: 'Leeds', blurb: 'Riverside parks, the Headrow and a strong independent food and music scene.' },
  { slug: 'bristol', name: 'Bristol', blurb: 'Harbourside, street art and independent cafés in a city that leans out.' },
  { slug: 'manchester', name: 'Manchester', blurb: 'Canal-side parks, music and a dense café scene in the centre.' },
  { slug: 'cardiff', name: 'Cardiff', blurb: 'Bay, castles and food markets in the Welsh capital.' },
  { slug: 'nottingham', name: 'Nottingham', blurb: 'Castle, parks and riverside walks close to the centre.' },
  { slug: 'leicester', name: 'Leicester', blurb: 'Jubilee Gardens, the waterfront and a lively food scene.' },
  { slug: 'liverpool', name: 'Liverpool', blurb: 'Waterfront, museums and parks on the edge of the Mersey.' },
  { slug: 'newcastle', name: 'Newcastle', blurb: 'Quayside parks and the Tyne close to the centre.' },
  { slug: 'york', name: 'York', blurb: 'The Minster, the city walls and a compact historic centre.' },
  { slug: 'oxford', name: 'Oxford', blurb: 'Rivers, parks and the oldest university city in England.' },
  { slug: 'cambridge', name: 'Cambridge', blurb: 'River Cam walks, gardens and college squares.' },
  { slug: 'bath', name: 'Bath', blurb: 'Roman baths, parks and Georgian streets that invite a slow day.' },
  { slug: 'brighton', name: 'Brighton', blurb: 'Seafront, gardens and a beach that pulls the whole city out.' },
  { slug: 'sheffield', name: 'Sheffield', blurb: 'Domes, parkland and valley parks ringing the city.' },
  { slug: 'derby', name: 'Derby', blurb: 'River Derwent walks and a compact centre by the rail station.' }
]
export { TOWNS }
