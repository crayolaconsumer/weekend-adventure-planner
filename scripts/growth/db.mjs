// MySQL source: accounts and activity, the source of truth for who uses ROAM.
//
// ACTIVE USER (the definition every activity number here uses): an account
// that did at least one of these in the period, by the row's own timestamp:
//   swiped a card       swiped_places.swiped_at
//   saved a place       saved_places.saved_at
//   marked a visit      visited_places.visited_at
//   rated a place       place_ratings.created_at
//   contributed         contributions.created_at (tip, photo, correction, story)
//   created a plan      plans.created_at (signed-in plans only; user_id NULL is anonymous)
//   followed someone    follows.created_at (the follower is the active one)
// Not counted: users.last_login_at (it only keeps the latest login, so a past
// week can't be rebuilt from it) and anonymous use (no account, no rows).
// Swipe/save rows are unique per (user, place): re-saving a place keeps the
// first timestamp, so these are lower bounds on activity.
//
// Read-only: SELECTs only, one connection, closed at the end.
import { readFileSync, existsSync } from 'node:fs'
import { days } from './lib.mjs'
import { UK_TOWNS } from '../../shared/ukTowns.mjs'
import { WORLD_TOWNS } from '../../shared/worldTowns.mjs'
import { haversineKm } from '../../shared/geo.mjs'

const DAY = 86400000
const KEYS = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']

/** MYSQL_* from the environment, else from .env.production / .env.local (gitignored). Never logged. */
export function dbConfig(env = process.env, root = new URL('../../', import.meta.url)) {
  const cfg = Object.fromEntries([...KEYS, 'MYSQL_PORT'].map(k => [k, env[k]]))
  for (const f of ['.env.production', '.env.local']) {
    if (KEYS.every(k => cfg[k])) break
    const p = new URL(f, root)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^(MYSQL_[A-Z]+)=(.*)$/.exec(line.trim())
      if (m && !cfg[m[1]]) cfg[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  }
  return KEYS.every(k => cfg[k]) ? cfg : null
}

const ACTIVITY_SQL = `
SELECT user_id, src, DATE_FORMAT(ts, '%Y-%m-%d') day, COUNT(*) n FROM (
  SELECT user_id, 'swipe' src, swiped_at ts FROM swiped_places WHERE swiped_at >= ? AND swiped_at < ?
  UNION ALL SELECT user_id, 'save', saved_at FROM saved_places WHERE saved_at >= ? AND saved_at < ?
  UNION ALL SELECT user_id, 'visit', visited_at FROM visited_places WHERE visited_at >= ? AND visited_at < ?
  UNION ALL SELECT user_id, 'rating', created_at FROM place_ratings WHERE created_at >= ? AND created_at < ?
  UNION ALL SELECT user_id, 'contribution', created_at FROM contributions WHERE created_at >= ? AND created_at < ?
  UNION ALL SELECT user_id, 'plan', created_at FROM plans WHERE user_id IS NOT NULL AND created_at >= ? AND created_at < ?
  UNION ALL SELECT follower_id, 'follow', created_at FROM follows WHERE created_at >= ? AND created_at < ?
) a GROUP BY user_id, src, day`

const PLACES_SQL = `
SELECT user_id, JSON_EXTRACT(place_data, '$.lat') lat, JSON_EXTRACT(place_data, '$.lng') lng FROM saved_places WHERE saved_at >= ? AND saved_at < ?
UNION ALL
SELECT user_id, JSON_EXTRACT(place_data, '$.lat'), JSON_EXTRACT(place_data, '$.lng') FROM visited_places WHERE visited_at >= ? AND visited_at < ? AND place_data IS NOT NULL`

const TOWNS = [...UK_TOWNS, ...WORLD_TOWNS]
export function nearestTown(lat, lng) {
  let best = null, bestKm = Infinity
  for (const t of TOWNS) {
    const km = haversineKm(lat, lng, t.lat, t.lng)
    if (km < bestKm) { bestKm = km; best = t }
  }
  // ponytail: nearest of ~2000 listed towns, so a village maps to its nearest listed town; 50 km+ is "elsewhere"
  return bestKm <= 50 ? `${best.name}${best.countryCode === 'gb' ? '' : `, ${best.country}`}` : 'Elsewhere'
}

/** Pure: turn the raw rows into the report's numbers. Exported for tests. */
export function summarise({ users, activity, places, paying }, win) {
  const d = s => new Date(s + 'T00:00:00Z')
  const inRange = (day, a, b) => d(day) >= a && d(day) < b
  const weeks = { this: [win.start, win.end], prev: [win.prevStart, win.start] }

  const actions = {}, active = {}
  for (const [wk, [a, b]] of Object.entries(weeks)) {
    actions[wk] = {}; active[wk] = new Set()
    for (const r of activity) if (inRange(r.day, a, b)) {
      actions[wk][r.src] = (actions[wk][r.src] || 0) + Number(r.n)
      active[wk].add(r.user_id)
    }
  }

  const created = u => new Date(u.created_at)
  const signupDays = days(new Date(+win.end - 14 * DAY), win.end)
  const perDay = Object.fromEntries(signupDays.map(x => [x, 0]))
  for (const u of users) {
    const k = created(u).toISOString().slice(0, 10)
    if (k in perDay) perDay[k]++
  }
  const newThis = users.filter(u => created(u) >= win.start && created(u) < win.end)
  const newPrev = users.filter(u => created(u) >= win.prevStart && created(u) < win.start)
  const activatedThis = newThis.filter(u => active.this.has(u.id)).length
  const activatedPrev = newPrev.filter(u => active.prev.has(u.id)).length

  // 30-day actives and account totals at each of the last 4 week ends (oldest first)
  const trend = [3, 2, 1, 0].map(k => {
    const at = new Date(+win.end - k * 7 * DAY)
    const from = new Date(+at - 30 * DAY)
    const ids = new Set(activity.filter(r => inRange(r.day, from, at)).map(r => r.user_id))
    return { weekEnding: new Date(+at - DAY).toISOString().slice(0, 10), accounts: users.filter(u => created(u) < at).length, active30d: ids.size }
  })

  const towns = {}
  for (const p of places) {
    const lat = Number(p.lat), lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue
    const t = nearestTown(lat, lng)
    towns[t] ??= { town: t, actions: 0, users: new Set() }
    towns[t].actions++; towns[t].users.add(p.user_id)
  }
  const topTowns = Object.values(towns).map(t => ({ town: t.town, actions: t.actions, users: t.users.size }))
    .sort((a, b) => b.actions - a.actions || b.users - a.users || a.town.localeCompare(b.town)).slice(0, 5)

  return {
    signupsPerDay: perDay,
    signups: { this: newThis.length, prev: newPrev.length },
    activatedSignups: { this: activatedThis, prev: activatedPrev },
    wau: { this: active.this.size, prev: active.prev.size },
    actions,
    accountsTotal: trend[3].accounts,
    trend,
    topTowns,
    paying: { subscribed: Number(paying.subscribed), noExpiry: Number(paying.no_expiry) },
  }
}

export async function collect(win, { connect } = {}) {
  let conn
  if (connect) conn = await connect()
  else {
    const cfg = dbConfig()
    if (!cfg) return { status: 'missing', need: 'MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE in the environment or .env.production' }
    const mysql = (await import('mysql2/promise')).default
    // timezone 'Z': Date params are sent as UTC, matching the server's UTC session
    conn = await mysql.createConnection({ host: cfg.MYSQL_HOST, user: cfg.MYSQL_USER, password: cfg.MYSQL_PASSWORD, database: cfg.MYSQL_DATABASE, port: Number(cfg.MYSQL_PORT) || 3306, timezone: 'Z', connectTimeout: 10000 })
  }
  try {
    const from = new Date(+win.end - (21 + 30) * DAY) // oldest point the 4-week 30-day trend needs
    const [users] = await conn.query('SELECT id, created_at FROM users WHERE created_at < ?', [win.end])
    const [activity] = await conn.query(ACTIVITY_SQL, Array(7).fill([from, win.end]).flat())
    const [places] = await conn.query(PLACES_SQL, [win.start, win.end, win.start, win.end])
    const [[paying]] = await conn.query(`SELECT
      SUM(tier = 'premium' AND subscription_expires_at > UTC_TIMESTAMP()) subscribed,
      SUM(tier = 'premium' AND subscription_expires_at IS NULL) no_expiry FROM users`)
    return { status: 'ok', ...summarise({ users, activity, places, paying }, win) }
  } finally {
    await conn.end()
  }
}
