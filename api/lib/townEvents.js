/**
 * "This weekend in <town>" for the town pages: Ticketmaster events (via the
 * existing proxy, api/events/ticketmaster.js) happening this Friday-Sunday in
 * the town's own time. People search "things to do this weekend in X"; this answers it.
 */

import { callJson } from './invoke.js'
import { cached } from './towns.js'
import { cacheGet, isCacheEnabled } from './kvCache.js'

// ~1,650 sitemap towns against Ticketmaster's ~5,000 calls/day, shared with the
// app's Events page: each town's weekend is fetched once and kept until the
// weekend is over (see weekendTtl)
const EVENTS_TIMEOUT_MS = 2500

const UK_TZ = 'Europe/London'

// Countries Ticketmaster's Discovery API covers that we show events for
export const EVENT_COUNTRIES = new Set(['gb', 'ie', 'us', 'ca', 'au', 'nz'])

/**
 * IANA time zone for a town in an events country, so "this weekend" is the
 * town's weekend. Wide countries go by coordinates; the bands are drawn
 * between the cities we ship, not along the exact zone borders.
 */
export function townTimeZone({ countryCode, lat, lng }) {
  switch (countryCode) {
    case 'ie': return 'Europe/Dublin'
    case 'nz': return 'Pacific/Auckland'
    case 'us':
      if (lng < -140) return lat > 50 ? 'America/Anchorage' : 'Pacific/Honolulu'
      if (lng > -86.5) return 'America/New_York' // Indianapolis, Louisville east; Nashville west
      if (lng > -101.5) return 'America/Chicago'
      if (lat > 31 && lat < 37 && lng > -114.8 && lng < -109) return 'America/Phoenix' // Arizona keeps no DST
      if (lng > -115) return 'America/Denver'
      return 'America/Los_Angeles'
    case 'ca':
      if (lng > -60) return 'America/St_Johns'
      if (lng > -67) return 'America/Halifax'
      if (lng > -90) return 'America/Toronto'
      if (lng > -102) return 'America/Winnipeg'
      if (lng > -118) return 'America/Edmonton'
      return 'America/Vancouver'
    case 'au':
      if (lng < 129) return 'Australia/Perth'
      if (lng < 141) return lat > -26 ? 'Australia/Darwin' : 'Australia/Adelaide'
      return lat > -28.2 ? 'Australia/Brisbane' : 'Australia/Sydney' // Queensland keeps no DST
    default: return UK_TZ
  }
}

const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const localWeekday = (d, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(d)
// 'YYYY-MM-DD' + n days, pure calendar arithmetic (no time zone involved)
const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/**
 * This weekend as local calendar dates { from, to } ('YYYY-MM-DD') in `tz`.
 * Mon-Thu: the coming Fri-Sun. Fri-Sun: today until Sunday.
 */
export function weekendWindow(now = new Date(), tz = UK_TZ) {
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(localWeekday(now, tz))
  const daysToFri = Math.max(0, 4 - dow)
  const daysToSun = 6 - dow
  // Day arithmetic on the local date itself: a UTC noon anchor is already
  // tomorrow in UTC+12/+13 (Auckland got Sat-Mon)
  const today = localDate(now, tz)
  return { from: addDays(today, daysToFri), to: addDays(today, daysToSun) }
}

// Milliseconds `tz` is ahead of UTC at instant `d` (BST +1h, Sydney +10h/+11h, LA -7h/-8h)
function tzOffsetMs(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 60000) * 60000
}

/** The UTC instant of local wall time `date`T`time` in `tz` (two passes settle DST changeovers). */
export function localToUtc(date, time, tz) {
  const wall = Date.parse(`${date}T${time}Z`)
  const guess = wall - tzOffsetMs(new Date(wall), tz)
  return wall - tzOffsetMs(new Date(guess), tz)
}

/**
 * Seconds from now until 23:59 local time on the window's last day (min 60), so
 * a town's events are fetched once per weekend. The key already carries the
 * window's first day, so the next weekend starts a fresh entry.
 */
export function weekendTtl({ to }, now = new Date(), tz = UK_TZ) {
  return Math.max(60, Math.ceil((localToUtc(to, '23:59:00', tz) - now.getTime()) / 1000))
}

// Events that started up to this long ago still count as on (see endTime)
const STILL_ON_MS = 3 * 60 * 60 * 1000
const isoUtc = ms => new Date(ms).toISOString().slice(0, 19) + 'Z'

/**
 * Exact UTC bounds of the town's local weekend for Ticketmaster: from local
 * Friday 00:00 (or 3h ago if later, so its single 50-event page isn't spent on
 * events that are over) to local Sunday 23:59:59.
 */
export function weekendQueryRange({ from, to }, now = new Date(), tz = UK_TZ) {
  return {
    start: isoUtc(Math.max(localToUtc(from, '00:00:00', tz), now.getTime() - STILL_ON_MS)),
    end: isoUtc(localToUtc(to, '23:59:59', tz))
  }
}

// Start + 3h, capped at the end of the day ("20:30" → "23:30", "22:00" → "23:59")
const endTime = t => {
  const [h, m] = t.split(':').map(Number)
  return h + 3 > 23 ? '23:59' : `${String(h + 3).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// "YYYY-MM-DDTHH:MM" now in the town's time, to compare with Ticketmaster's local times
const localNow = (d, tz) => `${localDate(d, tz)}T${new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)}`

/** Ticketmaster response → up to `limit` upcoming events in the window, soonest first, one per name. */
export function pickWeekendEvents(data, { from, to }, limit = 5, now = new Date(), tz = UK_TZ) {
  const seen = new Set()
  const current = localNow(now, tz)
  return (data?.events || [])
    .map(e => ({
      name: e.name,
      date: e.dates?.start?.localDate,
      time: e.dates?.start?.localTime?.slice(0, 5) || null,
      venue: e._embedded?.venues?.[0]?.name || null,
      url: /^https:\/\//.test(e.url || '') ? e.url : null
    }))
    .filter(e => e.name && e.date && e.date >= from && e.date <= to && e.url)
    // Hide events that are over: treat each as lasting 3h (no time given: all day)
    .filter(e => (e.time ? `${e.date}T${endTime(e.time)}` : `${e.date}T23:59`) >= current)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .filter(e => !seen.has(e.name.toLowerCase()) && seen.add(e.name.toLowerCase()))
    .slice(0, limit)
}

/** "Sat 27 Sep, 8pm" in UK style */
export function eventWhen({ date, time }) {
  const d = new Date(`${date}T12:00:00Z`)
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(d)
  if (!time) return day
  const [h, m] = time.split(':').map(Number)
  const hour12 = ((h + 11) % 12) + 1
  return `${day}, ${hour12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`
}

/**
 * This weekend's upcoming events near a town: [] if none or outside EVENT_COUNTRIES,
 * null if Ticketmaster failed or took over 2.5s (the page never waits on it). Cached per town and
 * weekend so crawls don't spend the Ticketmaster quota. A crawler (`bot`) only
 * ever reads the cache: it gets null on a miss and never calls Ticketmaster.
 */
export async function weekendEvents(town, ip, ticketmaster, { now = new Date(), radiusKm = 10, bot = false } = {}) {
  if (!EVENT_COUNTRIES.has(town.countryCode)) return []
  const tz = townTimeZone(town)
  const window = weekendWindow(now, tz)
  const key = `town:events:v2:${town.slug}:${window.from}`
  if (bot) {
    const hit = isCacheEnabled() ? await cacheGet(key) : null
    return hit ? pickWeekendEvents({ events: hit.value }, window, 5, now, tz) : null
  }
  const load = cached(key, () => weekendTtl(window, now, tz), async () => {
    const data = await callJson(ticketmaster, { lat: String(town.lat), lng: String(town.lng), radius: String(radiusKm), country: town.countryCode.toUpperCase(), ...weekendQueryRange(window, now, tz) }, ip)
    if (!data) throw new Error('ticketmaster unavailable') // failures aren't cached
    return data.events || []
  }).then(events => pickWeekendEvents({ events }, window, 5, now, tz)).catch(() => null)
  let timer
  // null = couldn't fetch (the page then caches briefly), [] = genuinely none
  const timeout = new Promise(res => { timer = setTimeout(() => res(null), EVENTS_TIMEOUT_MS) })
  return Promise.race([load, timeout]).finally(() => clearTimeout(timer))
}
