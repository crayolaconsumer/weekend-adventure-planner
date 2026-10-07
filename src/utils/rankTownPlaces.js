/**
 * The app's town page order: best-tagged places first (Overpass returns ID order), then the
 * most famous. qualityScore caps at 100, so in a city centre dozens of museums tie, and on
 * ID order the London Bridge Experience beat Westminster Abbey and the Tower of London.
 */
export function rankTownPlaces(places) {
  return [...places].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0) || (b.fame || 0) - (a.fame || 0))
}
