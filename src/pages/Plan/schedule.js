/**
 * Plan scheduling: when each stop happens, how long it lasts, and which
 * generated stops fit the chosen duration.
 *
 * Replaces the old fixed "10:00 start, a stop every 150 minutes" timing,
 * which ignored travel, opening hours and the length of the day the user
 * asked for (a "half day" walk came out at 7.5 hours and 13 km).
 */

import { haversineKm } from '../../../shared/geo.mjs'
import { parseOpeningHours } from '../../utils/openingHours'

// Minutes at a stop, by category. A quick look at a landmark is not a
// three-course lunch.
export const STOP_MINUTES = {
  food: 75,
  nightlife: 90,
  culture: 90,
  historic: 60,
  nature: 60,
  active: 90,
  entertainment: 120,
  shopping: 45,
  unique: 30,
}
const DEFAULT_STOP_MINUTES = 60

// Streets are not straight lines: turn crow-flies distance into a route
const ROUTE_FACTOR = 1.3

const MINUTE = 60000

export function stopMinutes(place) {
  return STOP_MINUTES[place?.category?.key] || DEFAULT_STOP_MINUTES
}

/** Travel estimate between two points at a mode's average speed (km/h). */
export function estimateTravelMinutes(from, to, speedKmh) {
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng || !speedKmh) return 0
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng) * ROUTE_FACTOR
  return Math.max(1, Math.round((km / speedKmh) * 60))
}

function roundUp(date, minutes) {
  const step = minutes * MINUTE
  return new Date(Math.ceil(date.getTime() / step) * step)
}

/**
 * When a plan made now should start: now, rounded up to the next quarter
 * hour. Late at night or before 8am it starts at 10:00 on the next
 * sensible morning instead.
 */
export function planStart(now = new Date()) {
  const start = roundUp(now, 15)
  if (start.getHours() >= 8 && start.getHours() < 21) return start
  const morning = new Date(start)
  if (start.getHours() >= 21) morning.setDate(morning.getDate() + 1)
  morning.setHours(10, 0, 0, 0)
  return morning
}

/**
 * Is the place open for a visit starting at `start`? True when it is open
 * on arrival and still open halfway through the visit; null when the hours
 * are unknown or unparseable.
 */
export function isOpenFor(place, start, minutes = 60) {
  const hours = place?.openingHours || place?.opening_hours
  if (!hours) return null
  if (/^\s*24\/7\s*$/.test(hours)) return true
  const oh = parseOpeningHours(hours, place)
  if (!oh) return null
  try {
    const t = new Date(start)
    const mid = new Date(t.getTime() + (minutes / 2) * MINUTE)
    return Boolean(oh.getState(t) && oh.getState(mid))
  } catch {
    return null
  }
}

/**
 * Time a list of stops back to back from `start`: travel from the previous
 * stop (or `origin`), a start rounded to 5 minutes, then the stop's own
 * length. Stops closed at their slot are marked `closedAtSlot`.
 *
 * @param {object[]} stops
 * @param {{start: Date|number, origin?: object|null, travel: (from, to) => number}} opts
 */
export function scheduleStops(stops, { start, origin = null, travel }) {
  let t = new Date(start)
  let prev = origin
  return stops.map((stop) => {
    if (prev) t = new Date(t.getTime() + travel(prev, stop) * MINUTE)
    t = roundUp(t, 5)
    const duration = typeof stop.duration === 'number' && stop.duration > 0 ? stop.duration : stopMinutes(stop)
    const scheduled = {
      ...stop,
      scheduledTime: t.toISOString(),
      duration,
      closedAtSlot: isOpenFor(stop, t, duration) === false,
    }
    t = new Date(t.getTime() + duration * MINUTE)
    prev = stop
    return scheduled
  })
}

/** When the last stop of a scheduled plan ends (ms), or null when empty. */
export function planEndMs(scheduled) {
  const last = scheduled[scheduled.length - 1]
  if (!last) return null
  return new Date(last.scheduledTime).getTime() + last.duration * MINUTE
}

function permutations(list) {
  if (list.length <= 1) return [list]
  return list.flatMap((item, i) =>
    permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(rest => [item, ...rest]))
}

/**
 * Order the user's own stops so as few as possible are closed at their
 * slot, then by the shortest day. Small lists only (5 stops = 120 orders);
 * longer lists keep the user's order.
 */
export function orderFixedStops(stops, { start, origin, travel }) {
  if (stops.length <= 1 || stops.length > 5) return scheduleStops(stops, { start, origin, travel })
  let best = null
  let bestKey = null
  for (const order of permutations(stops)) {
    const scheduled = scheduleStops(order, { start, origin, travel })
    const closed = scheduled.filter(s => s.closedAtSlot).length
    const key = [closed, planEndMs(scheduled)]
    if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = scheduled
      bestKey = key
    }
  }
  return best
}

/**
 * Build a plan: the user's own stops first (kept, never dropped), then
 * generated stops chosen one at a time. Each generated stop must be open
 * at its slot (or have unknown hours) and must finish before the day ends.
 * Among those it prefers a category not yet used (mixed plans: one each,
 * themed plans: up to two), and the nearest of the best-ranked few, so the
 * route stays tight.
 *
 * @param {object} opts
 * @param {object[]} opts.fixed - user-added stops
 * @param {object[]} opts.candidates - ranked places (best first)
 * @param {number} opts.count - total stops wanted
 * @param {Date|number} opts.start
 * @param {number} opts.durationMinutes
 * @param {object|null} opts.origin - where the user sets off from
 * @param {(from, to) => number} opts.travel - minutes between two points
 * @param {boolean} [opts.isMixed]
 */
export function buildPlan({ fixed = [], candidates = [], count, start, durationMinutes, origin = null, travel, isMixed = true }) {
  const deadline = new Date(start).getTime() + durationMinutes * MINUTE
  const plan = orderFixedStops(fixed, { start, origin, travel })
  const used = new Set(plan.map(s => s.id))
  const perCategory = {}
  const catKey = p => p.category?.key || 'other'
  for (const s of plan) perCategory[catKey(s)] = (perCategory[catKey(s)] || 0) + 1
  const limit = isMixed ? 1 : 2

  while (plan.length < count) {
    const prev = plan.length ? plan[plan.length - 1] : origin
    const from = planEndMs(plan) ?? new Date(start).getTime()
    const feasible = []
    for (const c of candidates) {
      if (used.has(c.id)) continue
      const minutes = prev ? travel(prev, c) : 0
      const arrive = roundUp(new Date(from + minutes * MINUTE), 5)
      const stay = stopMinutes(c)
      if (arrive.getTime() + stay * MINUTE > deadline) continue
      if (isOpenFor(c, arrive, stay) === false) continue
      feasible.push({ c, minutes, fresh: (perCategory[catKey(c)] || 0) < limit })
    }
    if (!feasible.length) break
    const pool = feasible.some(f => f.fresh) ? feasible.filter(f => f.fresh) : feasible
    const pick = pool.slice(0, 8).reduce((best, f) => (f.minutes < best.minutes ? f : best))
    used.add(pick.c.id)
    perCategory[catKey(pick.c)] = (perCategory[catKey(pick.c)] || 0) + 1
    const [scheduled] = scheduleStops([{ ...pick.c, duration: stopMinutes(pick.c) }], {
      start: from, origin: prev, travel,
    })
    plan.push(scheduled)
  }
  return plan
}

/**
 * Re-time a built plan with real travel times, then drop generated stops
 * from the end until it fits the day again. User-added stops are never
 * dropped.
 */
export function fitToDuration(plan, { start, origin, travel, durationMinutes }) {
  const deadline = new Date(start).getTime() + durationMinutes * MINUTE
  let stops = [...plan]
  let scheduled = scheduleStops(stops, { start, origin, travel })
  while (scheduled.length && planEndMs(scheduled) > deadline) {
    const lastGenerated = stops.map(s => !s.userAdded).lastIndexOf(true)
    if (lastGenerated === -1) break
    stops = stops.filter((_, i) => i !== lastGenerated)
    scheduled = scheduleStops(stops, { start, origin, travel })
  }
  return scheduled
}
