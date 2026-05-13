/**
 * Select stops with strict category diversity.
 *
 * Two modes:
 *
 *   - **Mixed** (isMixed=true): strict round-robin through every category
 *     present in the input pool, never picking the same category twice in
 *     a row. Produces "1 cafe → 1 museum → 1 park" itineraries.
 *
 *   - **Vibe** (isMixed=false): less strict — allows up to 2 picks from
 *     the same category, then fills the remainder from whatever's left.
 *
 * Used by Plan.jsx to assemble the itinerary stop list once the user
 * has picked a vibe + duration.
 *
 * @param {Array} places - Places to choose from (already filtered/scored)
 * @param {number} count - Target number of stops
 * @param {boolean} [isMixed=false] - Strict category rotation
 * @returns {Array} Selected stops, length ≤ count
 */
export function selectDiverseStops(places, count, isMixed = false) {
  if (places.length === 0) return []

  // Group by category
  const byCategory = {}
  for (const place of places) {
    const key = place.category?.key || 'other'
    if (!byCategory[key]) byCategory[key] = []
    byCategory[key].push(place)
  }

  // Shuffle within each category
  for (const key of Object.keys(byCategory)) {
    byCategory[key].sort(() => Math.random() - 0.5)
  }

  const selected = []

  // For mixed mode: strictly rotate through different categories
  if (isMixed) {
    const categoryKeys = Object.keys(byCategory)
    // Shuffle category order
    categoryKeys.sort(() => Math.random() - 0.5)

    const categoryIndices = {}
    categoryKeys.forEach(k => categoryIndices[k] = 0)

    // Round-robin through categories, never picking same category twice in a row
    let lastCategory = null
    let attempts = 0
    const maxAttempts = count * categoryKeys.length * 2

    while (selected.length < count && attempts < maxAttempts) {
      for (const catKey of categoryKeys) {
        if (selected.length >= count) break
        // Skip if same as last pick (prevent back-to-back same category)
        if (catKey === lastCategory && categoryKeys.length > 1) continue

        const catPlaces = byCategory[catKey]
        const idx = categoryIndices[catKey]

        if (idx < catPlaces.length) {
          selected.push(catPlaces[idx])
          categoryIndices[catKey]++
          lastCategory = catKey
        }
      }
      attempts++
    }
  } else {
    // For specific vibes: still ensure some variety but less strict
    const pool = [...places].sort(() => Math.random() - 0.5)
    for (const place of pool) {
      if (selected.length >= count) break
      const cat = place.category?.key || 'other'
      // Allow max 2 from same category
      const countInCat = selected.filter(p => (p.category?.key || 'other') === cat).length
      if (countInCat < 2) {
        selected.push(place)
      }
    }
    // Fill remaining if needed
    for (const place of pool) {
      if (selected.length >= count) break
      if (!selected.includes(place)) {
        selected.push(place)
      }
    }
  }

  return selected.slice(0, count)
}
