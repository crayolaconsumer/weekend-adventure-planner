/**
 * Places the user has swiped in the Discover deck, so the deck never deals
 * them again: a skip stays out for SKIP_DAYS, a like stays out for good
 * (liked places are saved; the saved list is where they live now).
 *
 * One store per user on this device (signed out: the anonymous store, which
 * is merged into the user's on sign-in, like the local-to-server sync).
 * localStorage key `${STORAGE_KEY}:${owner}`, grouped by (action, day):
 *   "s1fpj 27180417,27237812\nl1fpk 99"   one line per group
 * a line is the action (s|l), the local day number in base 36, a space, then
 * the ids. ~12 chars per place, so MAX_SEEN places stay well under 150 KB.
 * Past the cap the oldest skips go first, then the oldest likes. Every write
 * re-reads storage and merges, so two tabs don't erase each other's swipes.
 * Every storage access is try/catch: private mode, quota errors or a corrupt
 * value leave the deck working, just forgetful.
 */

export const STORAGE_KEY = 'roam_seen_v1'
export const ANON = 'anon'
export const SKIP_DAYS = 60
export const MAX_SEEN = 5000
// A deck is full at the picker's maxResults (applyFilters.ts). Below it,
// because swiped places were held back, the deck is running dry.
export const FULL_DECK = 50
// Last resort: when fewer than this many new places are left, the oldest
// skips (never today's) top the deck up to this many.
export const RECYCLE_FLOOR = 10

const DAY_MS = 86400000

/** Local calendar day number, so "today" means the user's today. */
export function dayOf(ms = Date.now()) {
  return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / DAY_MS)
}

let owner = ANON
let cache = null // Map<string id, { d: day, a: 's' | 'l' }>

const keyFor = who => `${STORAGE_KEY}:${who}`

function parse(raw) {
  const map = new Map()
  if (typeof raw !== 'string') return map
  for (const line of raw.split('\n')) {
    const sp = line.indexOf(' ')
    const a = line[0]
    const d = parseInt(line.slice(1, sp), 36)
    if (sp < 2 || (a !== 's' && a !== 'l') || !Number.isFinite(d)) continue
    for (const id of line.slice(sp + 1).split(',')) if (id) map.set(id, { d, a })
  }
  return map
}

function read(who) {
  try {
    return parse(localStorage.getItem(keyFor(who)))
  } catch {
    return new Map()
  }
}

function load() {
  if (!cache) cache = read(owner)
  return cache
}

/** Newer day wins; on the same day a like beats a skip. */
function mergeInto(map, id, e) {
  const prev = map.get(id)
  if (prev && (prev.d > e.d || (prev.d === e.d && (prev.a === 'l' || e.a === 's')))) return false
  map.set(id, e)
  return true
}

function save() {
  const map = load()
  // Another tab may have written since we read: union, newest day wins
  for (const [id, e] of read(owner)) mergeInto(map, id, e)
  if (map.size > MAX_SEEN) {
    // Evict skips before likes, oldest first
    const order = [...map].sort((x, y) => (x[1].a === y[1].a ? x[1].d - y[1].d : x[1].a === 's' ? -1 : 1))
    for (const [id] of order.slice(0, map.size - MAX_SEEN)) map.delete(id)
  }
  const groups = new Map()
  for (const [id, { d, a }] of map) {
    const k = a + d.toString(36)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(id)
  }
  try {
    localStorage.setItem(keyFor(owner), [...groups].map(([k, ids]) => `${k} ${ids.join(',')}`).join('\n'))
  } catch {
    // Quota / private mode: the in-memory copy still serves this session
  }
}

/**
 * Whose store is live: a user id, or null when signed out. Signing in merges
 * the anonymous store into the user's and empties it, so the next person to
 * sign in on this device doesn't inherit it. Returns true if the owner changed.
 */
export function setSeenOwner(userId) {
  const next = userId == null ? ANON : String(userId)
  if (next === owner) return false
  owner = next
  cache = null
  if (next !== ANON) {
    const anon = read(ANON)
    if (anon.size) {
      const map = load()
      for (const [id, e] of anon) mergeInto(map, id, e)
      save()
      try { localStorage.removeItem(keyFor(ANON)) } catch { /* private mode */ }
    }
  }
  return true
}

/** Remember a swipe. action: 'skip' | 'like'. */
export function recordSeen(placeId, action, now = Date.now()) {
  if (placeId == null) return
  const id = String(placeId)
  const map = load()
  map.delete(id)
  map.set(id, { d: dayOf(now), a: action === 'like' ? 'l' : 's' })
  save()
}

/**
 * Merge the server's swipes ({ placeId, swipedAt, action }) so swipes from
 * other devices count too. The newer record of a place wins. Returns how
 * many places were new to this device.
 */
export function mergeSeen(entries) {
  const map = load()
  let added = 0
  let changed = false
  for (const e of entries || []) {
    if (e?.placeId == null) continue
    const id = String(e.placeId)
    const isNew = !map.has(id)
    if (mergeInto(map, id, { d: dayOf(Number(e.swipedAt) || Date.now()), a: e.action === 'like' ? 'l' : 's' })) {
      changed = true
      if (isNew) added++
    }
  }
  if (changed) save()
  return added
}

export function seenCount() {
  return load().size
}

/** For tests: forget the in-memory copy (a page reload) and sign out. */
export function resetSeenCache({ keepOwner = false } = {}) {
  cache = null
  if (!keepOwner) owner = ANON
}

/** Places not held back by a swipe (a like, or a skip under SKIP_DAYS old). */
export function excludeSeen(places, now = Date.now()) {
  const map = load()
  if (!map.size || !places?.length) return places || []
  const today = dayOf(now)
  return places.filter(p => {
    const e = map.get(String(p.id))
    return !e || (e.a === 's' && today - e.d >= SKIP_DAYS)
  })
}

/**
 * Build the deck from everything in range: seen places are taken out BEFORE
 * the picker (`pick`, i.e. applyDiscoverFilters) ranks, so quality ranking
 * works on unseen supply only. Returns { places, fresh, recycled, dry }:
 *   fresh     new cards dealt
 *   dry       the deck is short (< FULL_DECK) BECAUSE of swipes: the whole
 *             pool, swiped places included, would have dealt more
 *   recycled  oldest skips appended when fewer than RECYCLE_FLOOR new cards
 *             are left. Only with `recycle` (the caller has no wider radius
 *             or filter to clear on offer), and never one skipped today.
 */
export function buildFreshDeck(places, pick, { now = Date.now(), recycle = false } = {}) {
  const all = places || []
  const unseen = excludeSeen(all, now)
  const deck = pick(unseen)
  const dry = unseen.length < all.length && deck.length < FULL_DECK && pick(all).length > deck.length
  if (!dry || !recycle || deck.length >= RECYCLE_FLOOR) return { places: deck, fresh: deck.length, recycled: 0, dry }

  const map = load()
  const today = dayOf(now)
  const unseenIds = new Set(unseen.map(p => p.id))
  const oldSkips = all.filter(p => {
    if (unseenIds.has(p.id)) return false
    const e = map.get(String(p.id))
    return e.a === 's' && e.d < today
  })
  if (!oldSkips.length) return { places: deck, fresh: deck.length, recycled: 0, dry }
  const day = p => map.get(String(p.id)).d
  const back = pick(oldSkips)
    .sort((x, y) => day(x) - day(y)) // stable: picker order within a day
    .slice(0, RECYCLE_FLOOR - deck.length)
  return { places: deck.concat(back), fresh: deck.length, recycled: back.length, dry }
}
