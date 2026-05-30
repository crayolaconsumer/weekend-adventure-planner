/**
 * placeBlurb — turn the structured OSM tags we already fetch into an
 * honest, specific one-line description + feature chips for a place card.
 *
 * The Discover deck looked bare for ordinary venues: a generic stock
 * photo and no text. But apiClient.parseOverpassResponse already pulls
 * cuisine, outdoor_seating, takeaway, delivery, wheelchair, heritage,
 * listed_status, fee, etc. onto the place — we just never surfaced them.
 *
 * This is NOT fabrication: every word here is derived from a real tag
 * the mapper set. We only emit a blurb when we can say something MORE
 * than the bare type chip already shown on the card (a cuisine, a
 * listing status, or a notable feature) — otherwise we return null and
 * let the existing type chip speak for itself.
 */

// Common OSM cuisine tokens → display labels. Unknown values fall back
// to a humanised version of the raw token.
const CUISINE_LABELS = {
  italian: 'Italian', chinese: 'Chinese', indian: 'Indian', japanese: 'Japanese',
  thai: 'Thai', mexican: 'Mexican', french: 'French', greek: 'Greek',
  turkish: 'Turkish', spanish: 'Spanish', american: 'American', british: 'British',
  vietnamese: 'Vietnamese', korean: 'Korean', lebanese: 'Lebanese', portuguese: 'Portuguese',
  caribbean: 'Caribbean', ethiopian: 'Ethiopian', moroccan: 'Moroccan', persian: 'Persian',
  pizza: 'Pizza', burger: 'Burger', seafood: 'Seafood', sushi: 'Sushi',
  kebab: 'Kebab', fish_and_chips: 'Fish & chips', sandwich: 'Sandwich',
  breakfast: 'Brunch', bakery: 'Bakery', dessert: 'Dessert', ice_cream: 'Ice cream',
  coffee_shop: 'Coffee', tapas: 'Tapas', noodle: 'Noodle', ramen: 'Ramen',
  vegetarian: 'Vegetarian', vegan: 'Vegan', steak_house: 'Steakhouse', barbecue: 'BBQ',
}

// Raw OSM type → a nicer noun. Anything not listed gets _ → space.
const TYPE_NOUNS = {
  restaurant: 'restaurant', cafe: 'café', fast_food: 'takeaway spot', pub: 'pub',
  bar: 'bar', biergarten: 'beer garden', nightclub: 'club', food_court: 'food court',
  museum: 'museum', gallery: 'gallery', artwork: 'public artwork', attraction: 'attraction',
  viewpoint: 'viewpoint', monument: 'monument', memorial: 'memorial', castle: 'castle',
  ruins: 'ruins', fort: 'fort', archaeological_site: 'historic site',
  theatre: 'theatre', cinema: 'cinema', arts_centre: 'arts centre',
  park: 'park', garden: 'garden', nature_reserve: 'nature reserve',
  recreation_ground: 'green space', common: 'common', beach: 'beach',
  place_of_worship: 'place of worship', library: 'library', marketplace: 'market',
}

const FOOD_TYPES = new Set(['restaurant', 'cafe', 'fast_food', 'pub', 'bar', 'biergarten', 'food_court'])

function firstCuisine(raw) {
  if (!raw || typeof raw !== 'string') return null
  const token = raw.split(';')[0].trim().toLowerCase()
  if (!token) return null
  return CUISINE_LABELS[token] || token.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function typeNoun(type) {
  if (!type) return null
  const t = String(type).toLowerCase()
  return TYPE_NOUNS[t] || t.replace(/_/g, ' ')
}

// "Grade II listed", "Heritage site" — only when the tags actually say so.
function listedLabel(place) {
  if (!place) return null
  const ls = place.listed_status || place.designation
  if (ls && /grade\s*\*?\s*(i{1,3}|2|1)/i.test(String(ls))) {
    const m = String(ls).match(/grade\s*\*?\s*(i{1,3}|1|2)/i)
    return m ? `Grade ${m[1].toUpperCase()} listed` : 'Listed'
  }
  if (place.heritage) return 'Heritage'
  return null
}

function capitaliseFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * Compose an honest one-line blurb, or null if we can't add anything
 * beyond the type chip the card already shows.
 */
export function composeBlurb(place) {
  if (!place) return null
  const type = String(place.type || '').toLowerCase()
  const noun = typeNoun(type)
  if (!noun) return null

  const cuisine = firstCuisine(place.cuisine)
  const cuisineApplies = cuisine && FOOD_TYPES.has(type)
  const listed = listedLabel(place)

  // The blurb is the place's *identity* only — a cuisine ("Italian
  // restaurant") or a listing/heritage status ("Grade II listed church").
  // Amenities (outdoor seating, takeaway, …) are shown as feature chips
  // instead, so no fact appears in two places. If we can't add anything
  // beyond the bare type chip, return null and let that chip speak.
  if (!cuisineApplies && !listed) return null

  const lead = cuisineApplies ? `${cuisine} ${noun}` : `${listed} ${noun}`
  return capitaliseFirst(lead)
}

/**
 * Short, scannable feature chips from real tags — the kind of thing
 * that actually helps someone decide whether to go. Capped so the card
 * stays clean.
 */
export function placeFeatures(place) {
  const out = []
  if (!place) return out
  if (place.outdoor_seating === 'yes') out.push('Outdoor seating')
  if (place.takeaway === 'yes') out.push('Takeaway')
  if (place.delivery === 'yes') out.push('Delivery')
  if (place.wheelchair === 'yes') out.push('Step-free')
  if (place.fee === 'no') out.push('Free entry')
  if (listedLabel(place)) out.push('Listed building')
  return out.slice(0, 3)
}

export default { composeBlurb, placeFeatures }
