/**
 * "This weekend in <town>" for the town pages: Ticketmaster events (via the
 * existing proxy, api/events/ticketmaster.js) happening this Friday-Sunday in
 * UK time. People search "things to do this weekend in X"; this answers it.
 */

import { callJson } from './invoke.js'
import { cached } from './towns.js'

// ~1,650 sitemap towns against Ticketmaster's ~5,000 calls/day, shared with the
// app's Events page: refresh each town at most twice a day
const EVENTS_TTL = 12 * 60 * 60
const NO_EVENTS_TTL = 6 * 60 * 60
const EVENTS_TIMEOUT_MS = 2500

const ukDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const ukWeekday = d => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(d)
const DAY = 86400000

/**
 * This weekend as UK calendar dates { from, to } ('YYYY-MM-DD').
 * Mon-Thu: the coming Fri-Sun. Fri-Sun: today until Sunday.
 */
export function weekendWindow(now = new Date()) {
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(ukWeekday(now))
  const daysToFri = Math.max(0, 4 - dow)
  const daysToSun = 6 - dow
  // Noon anchor keeps DST changes from shifting the date
  const noon = new Date(`${ukDate(now)}T12:00:00Z`).getTime()
  return { from: ukDate(new Date(noon + daysToFri * DAY)), to: ukDate(new Date(noon + daysToSun * DAY)) }
}

// Start + 3h, capped at the end of the day ("20:30" → "23:30", "22:00" → "23:59")
const endTime = t => {
  const [h, m] = t.split(':').map(Number)
  return h + 3 > 23 ? '23:59' : `${String(h + 3).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// "YYYY-MM-DDTHH:MM" now in UK time, to compare with Ticketmaster's local times
const ukNow = d => `${ukDate(d)}T${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)}`

/** Ticketmaster response → up to `limit` upcoming events in the window, soonest first, one per name. */
export function pickWeekendEvents(data, { from, to }, limit = 5, now = new Date()) {
  const seen = new Set()
  const current = ukNow(now)
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
 * This weekend's upcoming events near a UK town: [] if none or outside the UK,
 * null if Ticketmaster failed or took over 2.5s (the page never waits on it). Cached per town and
 * weekend so crawls don't spend the Ticketmaster quota.
 */
export async function weekendEvents(town, ip, ticketmaster, { now = new Date(), radiusKm = 10 } = {}) {
  if (town.countryCode !== 'gb') return []
  const window = weekendWindow(now)
  const load = cached(`town:events:v2:${town.slug}:${window.from}`, v => (v.length ? EVENTS_TTL : NO_EVENTS_TTL), async () => {
    const data = await callJson(ticketmaster, { lat: String(town.lat), lng: String(town.lng), radius: String(radiusKm), ...window }, ip)
    if (!data) throw new Error('ticketmaster unavailable') // failures aren't cached
    return data.events || []
  }).then(events => pickWeekendEvents({ events }, window, 5, now)).catch(() => null)
  let timer
  // null = couldn't fetch (the page then caches briefly), [] = genuinely none
  const timeout = new Promise(res => { timer = setTimeout(() => res(null), EVENTS_TIMEOUT_MS) })
  return Promise.race([load, timeout]).finally(() => clearTimeout(timer))
}
