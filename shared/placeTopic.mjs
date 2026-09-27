// Is this Wikipedia article / Wikidata item / Commons photo really about the
// place? OSM mappers sometimes tag a memorial with the event it remembers
// (9/11 Memorial & Museum → wikidata=Q10806 "September 11 attacks"), which put
// a photo of the burning towers and the article on the attacks on the place
// page. Shared by api/places/image-resolve.js and the client's Wikipedia path.

// Words that say what kind of place it is, not which one: two names sharing
// only "park" or "street" are not the same place
const STOPWORDS = new Set([
  'the', 'and', 'of', 'at', 'in', 'on', 'to', 'for', 'with', 'by', 'from', 'le', 'la', 'de', 'du', 'des',
  'park', 'parks', 'garden', 'gardens', 'street', 'road', 'lane', 'avenue', 'square', 'place', 'green',
  'playground', 'field', 'fields', 'common', 'wood', 'woods', 'house', 'hall', 'church', 'chapel',
  'museum', 'gallery', 'memorial', 'centre', 'center', 'building', 'tower', 'bridge', 'saint', 'north',
  'south', 'east', 'west', 'new', 'old', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'file'
])

/** Distinctive lowercase words of a name or file title (letters only, 3+ long). */
export function meaningfulWords(text) {
  if (typeof text !== 'string') return []
  return (text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z]{3,}/g) || [])
    .filter(w => !STOPWORDS.has(w))
}

export function sharesMeaningfulWord(a, b) {
  const words = new Set(meaningfulWords(a))
  return meaningfulWords(b).some(w => words.has(w))
}

// Titles and short descriptions of articles about something that happened
// 'war' is left out: war museums and memorials are places (the Wikidata
// class check catches actual wars)
const EVENT_WORDS = /\b(attacks?|bombings?|massacres?|disasters?|battles?|sieges?|shootings?|explosions?|hijackings?|crash(es)?|riots?|earthquakes?|genocide|assassinations?|terrorist|terrorism|invasions?|uprising|rebellion)\b/i

/**
 * A Wikipedia summary ({ title, description }) is about an event rather than
 * the place: its title shares no distinctive word with the place name and
 * the title or description names an event. Without a place name only the
 * title is judged.
 */
export function isEventArticle(summary, placeName) {
  const title = typeof summary?.title === 'string' ? summary.title : ''
  if (!title) return false
  // An event-titled article ('September 11 attacks') is about the event even
  // when it shares words with the place ('National September 11 Memorial'),
  // unless the place's own name is event-worded ('Battle Abbey')
  const placeIsEventNamed = Boolean(placeName) && EVENT_WORDS.test(placeName)
  if (EVENT_WORDS.test(title) && !placeIsEventNamed) return true
  if (placeName && sharesMeaningfulWord(placeName, title)) return false
  const description = placeName && typeof summary?.description === 'string' ? summary.description : ''
  return EVENT_WORDS.test(description) && !placeIsEventNamed
}

// Wikidata classes (P31) of things that happened, not places
const EVENT_CLASSES = new Set([
  'Q1190554', // occurrence
  'Q2223653', // terrorist attack
  'Q217327', // suicide attack
  'Q891854', // bomb attack
  'Q750215', // mass murder
  'Q3199915', // massacre
  'Q21480300', // mass shooting
  'Q898712', // aircraft hijacking
  'Q744913', // aviation accident
  'Q178561', // battle
  'Q198', // war
  'Q645883', // military operation
  'Q188055', // siege
  'Q3839081', // disaster
  'Q8065', // natural disaster
  'Q7944', // earthquake
  'Q124757' // riot
])

/**
 * A Wikidata entity is an event: an instance of a known event class, or it
 * has a point in time (P585) and no coordinates (P625), which places have.
 * ponytail: direct P31 only, no subclass walk; add one if events slip through.
 */
export function isEventEntity(entity) {
  const claims = entity?.claims
  if (!claims) return false
  const classes = (claims.P31 || []).map(c => c?.mainsnak?.datavalue?.value?.id)
  if (classes.some(id => EVENT_CLASSES.has(id))) return true
  return Boolean(claims.P585?.length) && !claims.P625?.length
}

// Safety net for images of disasters, whatever their source
// Whole words only ('Crashaw Gardens' is fine) and no 'wreck' (Mary Rose)
const DISTRESSING = /\b(smoking|burning|attacks?|explosions?|bombings?|massacres?|corpses?|crash(es|ed)?)\b/i

/** An image URL or file name whose file name names something distressing. */
export function isDistressingImage(urlOrName) {
  if (typeof urlOrName !== 'string' || !urlOrName) return false
  let s = urlOrName
  try { s = decodeURIComponent(urlOrName) } catch { /* keep raw */ }
  // The file name, not the host or query (…/Special:FilePath/<name>?width=800)
  const name = s.split('?')[0].split('/').filter(Boolean).pop() || ''
  // Underscores and hyphens separate words in Commons file names
  return DISTRESSING.test(name.replace(/[_-]+/g, ' '))
}
