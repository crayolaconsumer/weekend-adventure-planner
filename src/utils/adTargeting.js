/**
 * Contextual ad targeting for ROAM.
 *
 * Turns the user's current Discover context (selected category filters +
 * the place they're currently looking at) into keywords + a content URL
 * that we pass to AdMob on each ad request. This makes the programmatic
 * ads materially more relevant — a discovery app should surface
 * travel/leisure/local demand, not random app-install or gambling ads.
 *
 * The native @capacitor-community/admob plugin is patched (see
 * patches/@capacitor-community+admob+8.0.0.patch) to forward `keywords`
 * and `contentUrl` into the underlying GADRequest / AdRequest. Combined
 * with the global maxAdContentRating=PG cap set at init, this keeps the
 * free-tier ad experience on-brand.
 */

import { GOOD_CATEGORIES } from './categories'

// Always-on signals describing what ROAM is about. Anchors ad demand to
// travel/leisure even before the user has picked a category filter.
const BASE_KEYWORDS = [
  'travel',
  'leisure',
  'days out',
  'things to do',
  'weekend',
  'tourism',
  'attractions',
  'local',
  'uk',
]

// AdMob's index page is the most on-topic, always-200 URL we can hand to
// Google for content analysis. The SPA serves identical HTML for every
// path, so a per-category path would add no crawl value — keywords carry
// the dynamic signal instead.
const CANONICAL_URL = 'https://www.go-roam.uk'

// Keep the keyword list tidy — Google only uses a bounded set and a huge
// list dilutes intent.
const MAX_KEYWORDS = 20

/**
 * @param {Object} ctx
 * @param {string[]} [ctx.selectedCategories] - active category-filter keys
 * @param {Object|null} [ctx.place] - the current place (has .category {key,label})
 * @returns {{ keywords: string[], contentUrl: string }}
 */
export function buildAdTargeting({ selectedCategories = [], place = null } = {}) {
  const keywords = [...BASE_KEYWORDS]

  for (const key of selectedCategories) {
    const cat = GOOD_CATEGORIES[key]
    if (cat?.label) keywords.push(cat.label.toLowerCase())
    keywords.push(key)
  }

  const placeCat = place?.category
  if (placeCat?.key) keywords.push(placeCat.key)
  if (placeCat?.label) keywords.push(placeCat.label.toLowerCase())

  const deduped = Array.from(new Set(keywords.filter(Boolean))).slice(0, MAX_KEYWORDS)

  return { keywords: deduped, contentUrl: CANONICAL_URL }
}

export default buildAdTargeting
