/**
 * When the nearby deck runs dry (seenPlaces.buildFreshDeck says `dry`), top it
 * up instead of only telling the user to search further out:
 *   further  unseen places just past the selected distance band, nearest
 *            first, labelled "A bit further"
 *   ready    saved places not yet visited, in range and not known to be
 *            closed, dealt back as "Ready to go?" cards: at most one card in
 *            READY_EVERY, never two in a row
 * Any swipe on a ready card snoozes it for SNOOZE_DAYS (never the seen store:
 * that would turn a saved place's permanent like into a 60-day skip), and
 * anything swiped this session is never dealt back as one.
 * Storage access is try/catch: private mode just forgets snoozes.
 */
import { calculateDistance, isClosedNow } from '../../utils/placeFilter'
import { excludeSeen } from '../../utils/seenPlaces'

export const FURTHER_MAX = 20
export const READY_EVERY = 5
export const SNOOZE_DAYS = 21
export const SNOOZE_KEY = 'roam_ready_snooze_v1'

const DAY_MS = 86400000

/** { id: snoozedUntilMs } with expired entries dropped. */
export function readSnoozes(now = Date.now()) {
  try {
    const all = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}')
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now))
  } catch {
    return {}
  }
}

export function snoozeReady(id, now = Date.now()) {
  try {
    const live = readSnoozes(now)
    live[String(id)] = now + SNOOZE_DAYS * DAY_MS
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(live))
  } catch {
    // forgetful, not broken
  }
}

/** A place as the saved list should hold it: no deck-only labels. */
export const withoutDeckFlags = ({ further: _further, readyToGo: _ready, ...place }) => place

/**
 * Unseen places beyond the band's edge (`bandMaxKm`) and within `maxKm` (the
 * user's reach: past the mode's radius only when the next mode is theirs),
 * run through the picker without the band, nearest first.
 */
export function furtherCards(unseen, deckIds, bandMaxKm, pick, maxKm = Infinity) {
  const beyond = unseen.filter(p => typeof p.distance === 'number' && p.distance > bandMaxKm && p.distance <= maxKm && !deckIds.has(String(p.id)))
  if (!beyond.length) return []
  return pick(beyond)
    .slice()
    .sort((a, b) => a.distance - b.distance)
    .slice(0, FURTHER_MAX)
    .map(p => ({ ...p, further: true }))
}

/** Saved places worth dealing back now, nearest first. `exclude`: ids (strings) swiped this session. */
export function readyCards(saved, { origin, maxKm, deckIds, exclude = new Set(), now = Date.now() }) {
  if (!origin || !saved?.length) return []
  const snoozed = readSnoozes(now)
  const out = []
  for (const p of saved) {
    const id = String(p?.id)
    if (p?.lat == null || p?.lng == null || deckIds.has(id) || exclude.has(id) || snoozed[id]) continue
    if (isClosedNow(p)) continue
    const distance = calculateDistance(origin.lat, origin.lng, p.lat, p.lng)
    if (distance > maxKm) continue
    out.push({ ...withoutDeckFlags(p), distance, readyToGo: true })
  }
  return out.sort((a, b) => a.distance - b.distance)
}

/**
 * One ready card after every READY_EVERY - 1 regular cards. `lead`: regular cards
 * before the first one (default a full gap). A rebuilt deck passes the gap left
 * after the regular cards already swiped since the last ready card (0 = it's due
 * now), so a ready card keeps its place in the hand across rebuilds.
 */
export function weaveReady(cards, ready, lead = READY_EVERY - 1) {
  const out = []
  let r = 0
  if (lead <= 0 && r < ready.length) out.push(ready[r++])
  cards.forEach((card, i) => {
    out.push(card)
    const sinceLead = i + 1 - Math.max(0, lead)
    if (sinceLead >= 0 && sinceLead % (READY_EVERY - 1) === 0 && r < ready.length && (lead > 0 || sinceLead > 0)) out.push(ready[r++])
  })
  return { places: out, ready: r }
}

/** Ids (strings) of the unswiped regular cards dealt ahead of the next unswiped ready card; empty when none is in hand. */
export function aheadOfReady(places, swiped) {
  const gone = new Set([...swiped].map(String))
  const left = places.filter(p => !gone.has(String(p.id)))
  const next = left.findIndex(p => p.readyToGo)
  return new Set(next < 0 ? [] : left.slice(0, next).map(p => String(p.id)))
}

/**
 * The deck to deal: `freshDeck` (buildFreshDeck's result) as it is when full;
 * when dry, its cards, then further cards, with ready cards woven in. `pick`
 * is the deck picker with overrides (applyFilters); `bandMaxKm` the selected
 * band's edge; `rangeKm` the travel mode's reach (ready cards stay inside it);
 * `filtered` = category/eligibility filters on (ready cards wait).
 */
export function topUpDeck({ freshDeck, basePlaces, readyPool, pick, bandMaxKm, furtherMaxKm, rangeKm, origin, filtered, exclude, readyLead, readyAfter, now }) {
  if (!freshDeck.dry) return { places: freshDeck.places, fresh: freshDeck.fresh, further: 0, ready: 0 }
  const deckIds = new Set(freshDeck.places.map(p => String(p.id)))
  const further = furtherCards(excludeSeen(basePlaces, now), deckIds, bandMaxKm, list => pick(list, { selectedBand: null }), furtherMaxKm)
  // readyAfter: ids (strings) of the cards the user holds ahead of the next ready card. A rebuild
  // re-ranks (time of day, diversity), so a count alone would let a different card slip ahead of
  // it: those cards go first, in the new order (only when a ready card is actually woven in)
  const ranked = freshDeck.places.concat(further)
  const ready = filtered ? [] : readyCards(readyPool, { origin, maxKm: rangeKm, deckIds: new Set(ranked.map(p => String(p.id))), exclude, now })
  const regular = readyAfter?.size && ready.length
    ? ranked.filter(p => readyAfter.has(String(p.id))).concat(ranked.filter(p => !readyAfter.has(String(p.id))))
    : ranked
  const woven = weaveReady(regular, ready, readyLead)
  return { places: woven.places, fresh: freshDeck.fresh, further: further.length, ready: woven.ready }
}

/**
 * A swipe on a ready card. It's already saved and a like in the seen store, so
 * nothing is saved or recorded: go = a pending visit (CardStack has opened the
 * directions), right = plan it, left = not now. Every outcome snoozes it, so it
 * isn't dealt straight back next session. Returns the outcome.
 */
export function readySwipe(action, place, { plan, wentOut, now = Date.now() }) {
  snoozeReady(place.id, now)
  if (action === 'nope') return 'snoozed'
  if (action === 'like') {
    plan(place)
    return 'plan'
  }
  if (action === 'go') {
    wentOut(place)
    return 'went'
  }
  return null
}
