// Bare numeric OSM ids are ambiguous: nodes, ways and relations each have
// their own number space, so "12345" can be a café node AND a road way.
// Pick the element that is actually a place: named, carrying a place tag,
// not a plain road (a road tagged as an attraction, like York's Shambles,
// counts); if still tied, the node (what the app has always done).
// Evidence: 311877305 is both the Costa node in Soho and a road in France;
// 500288911 is both an untagged node in Germany and a London park way.
// Every key Discover queries (shared/overpassQuery.js TYPE_TO_KEYS)
const PLACE_TAGS = ['amenity', 'tourism', 'leisure', 'historic', 'shop', 'natural', 'man_made']

const score = e => {
  const t = e.tags || {}
  const place = PLACE_TAGS.some(k => t[k])
  if (!t.name || (t.highway && !place)) return -1
  return place ? 2 : 1
}

/** The element a bare numeric id most likely refers to, or null. */
export function pickPlaceElement(elements = []) {
  const ranked = elements
    .map((e, i) => ({ e, s: score(e), i: e.type === 'node' ? 0 : 1 }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
  return ranked[0]?.e || null
}
