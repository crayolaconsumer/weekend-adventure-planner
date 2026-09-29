/**
 * Overpass response trimming.
 *
 * Overpass returns every OSM tag it holds for every element. For a dense
 * city bbox that is enormous and almost entirely dead weight: a measured
 * London Discover response (14,295 elements) was 5.13 MB, of which the tag
 * blocks alone were 3.74 MB spread over 647 DISTINCT tag keys — while the
 * client reads about 29 of them. `addr:*` by itself accounted for 883 KB
 * and nothing in the app reads it.
 *
 * That mattered for more than bandwidth. The KV cache refuses payloads over
 * 900 KB (Upstash's free tier caps a single request at 1 MB), so the biggest,
 * most-requested cities were the exact ones that could NEVER be cached — every
 * single request went upstream to Overpass. Those are free community servers
 * and the usage policy is not a suggestion; uncached traffic at scale is how
 * an app gets IP-banned.
 *
 * Trimming to the whitelist below takes that response to 2.75 MB, and gzipped
 * in the cache layer it lands at ~731 KB — under the cap. Dense cities become
 * cacheable for the first time.
 *
 * SHAPE IS DELIBERATELY UNCHANGED: `{ elements: [{ type, id, lat, lon |
 * center, tags }] }`. The native iOS/Android apps bundle their JavaScript at
 * build time (capacitor.config.json sets `webDir: "dist"` with no
 * `server.url`), so versions already in the app stores run OLD client code and
 * will never receive a client-side update. Anything that changed the envelope
 * would break them. Dropping unread tag KEYS degrades gracefully — a missing
 * optional tag renders as absent, it does not throw.
 */

/**
 * Tag keys the client actually reads, derived from the app source.
 *
 * Add to this list rather than removing the trim if a feature needs a new
 * tag — a key that is missing here is simply absent client-side, which is
 * easy to mistake for missing OSM data.
 */
export const TAG_WHITELIST = new Set([
  // identity / display
  'name',
  'name:en', // fallback in parseOverpassResponse when `name` is absent
  'description',
  'description:en',
  'image',
  // Address. formatAddress() joins these four into the `address` field shown
  // in the UI — they are read via bracket notation inside a helper, which is
  // exactly how they got missed on the first pass and shipped as blank
  // addresses. They are also the single biggest tag group (~883 KB on a
  // London response), so the temptation to drop them is real: don't.
  'addr:housenumber',
  'addr:street',
  'addr:city',
  'addr:postcode',
  // formatAddress falls back to these when addr:city is missing
  'addr:town',
  'addr:village',
  'addr:state',
  // Not read by CURRENT src/ — it was dropped from quality scoring in 92cfc12
  // (15 May 2026). Kept because native builds from before that date are
  // immutable and still in users' hands, and they use it for a UK/local
  // scoring boost. The whitelist has to satisfy every SHIPPED client, not just
  // the current source tree.
  'addr:country',
  // classification — these drive category, icon and filtering
  'amenity',
  'craft',
  'designation',
  'heritage',
  'historic',
  'landuse',
  'leisure',
  'man_made',
  'natural',
  'water', // town pages: lakes vs ponds
  'waterway',
  'highway', // osmPick scores bare roads down so a road id never resolves as a place
  'shop',
  'tourism',
  // detail panel
  'brand',
  'brand:wikidata',
  'contact:phone',
  'contact:website',
  'cuisine',
  'delivery',
  'fee',
  'opening_hours',
  'outdoor_seating',
  'phone',
  'takeaway',
  'website',
  'wheelchair',
  // bring-the-dog filter (premium) reads dog=* + the conditional terms
  'dog',
  'dog:conditional',
  // access=private / access=no places are dropped from the deck (placeFilter)
  'access',
  // heritage/listed-building filters read these two via bracket notation
  'listed_status',
  'HE_ref',
  // enrichment / cross-references
  'wikidata',
  'wikimedia_commons',
  'wikipedia',
])

/** Element-level keys to keep. `center` is how Overpass reports way/relation
 *  positions (`out center`); nodes carry `lat`/`lon` instead. Both are needed. */
const ELEMENT_KEYS = ['type', 'id', 'lat', 'lon', 'center', 'bounds'] // bounds: town pages rank parks by size

/**
 * Strip an Overpass response down to the fields the app consumes.
 *
 * Defensive by design: anything that isn't the expected shape is returned
 * untouched. A trimming bug must never be able to turn a working Discover
 * response into a broken one.
 *
 * @param {any} data - parsed Overpass JSON
 * @returns {any} the same shape, with unused tags and fields removed
 */
export function trimOverpassResponse(data) {
  if (!data || !Array.isArray(data.elements)) return data

  const elements = new Array(data.elements.length)
  for (let i = 0; i < data.elements.length; i++) {
    const el = data.elements[i]
    if (!el || typeof el !== 'object') {
      elements[i] = el
      continue
    }

    const out = {}
    for (const k of ELEMENT_KEYS) {
      if (el[k] !== undefined) out[k] = el[k]
    }

    const tags = el.tags
    if (tags && typeof tags === 'object') {
      let kept = null
      for (const key in tags) {
        // name:xx translations: town pages rank fame by how many a place has
        if (TAG_WHITELIST.has(key) || key.startsWith('name:')) {
          if (kept === null) kept = {}
          kept[key] = tags[key]
        }
      }
      // Omit `tags` entirely when nothing survived, rather than emitting an
      // empty object on every untagged element — that is ~14 bytes each and
      // there are thousands of them.
      if (kept !== null) out.tags = kept
    }

    elements[i] = out
  }

  return { ...data, elements }
}
