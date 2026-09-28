/**
 * GET /api/places/trending
 *
 * Get trending places based on recent activity
 * Calculates popularity from contributions, saves, and plan inclusions
 */

import { query } from '../lib/db.js'
import { getUserFromRequest } from '../lib/auth.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

// The ranking and the place data are global (the same for every viewer) and
// move slowly, but the ranking is a 30-day UNION/GROUP BY over three tables:
// run each at most once per 5 min per instance, one run at a time. Only the
// viewer-specific block filter on tips and photos runs per request.
// ponytail: per-instance memo capped at 200 keys; move to KV (one run fleet-wide) if instances multiply
const MEMO_MS = 5 * 60 * 1000
const memo = new Map()
function memoized(key, load) {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value
  if (memo.size >= 200) for (const [k, v] of memo) if (Date.now() - v.at >= MEMO_MS) memo.delete(k)
  if (memo.size >= 200) memo.delete(memo.keys().next().value) // hard cap: oldest first
  const value = Promise.resolve().then(load)
  memo.set(key, { at: Date.now(), value })
  value.catch(() => { if (memo.get(key)?.value === value) memo.delete(key) }) // never keep a failure
  return value
}
export function _resetTrendingMemo() { memo.clear() }

// place_data is whatever the saving client posted, served here to everyone:
// keep only what the card needs to name the place and find its own photo.
// Dropped: client-computed fields (distance gives away where the saver was),
// any image URL, and websites (image-resolve would use that site's og:image):
// a saver must not choose the picture on everyone's card. Real user photos
// come from approved contributions below; Wikipedia/Wikidata/Commons picks
// are community-curated and filtered by image-resolve.
const TEXT_KEYS = ['name', 'type', 'wikipedia', 'wikidata', 'wikimedia_commons']
const TAG_KEYS = ['wikipedia', 'wikidata', 'wikimedia_commons']
const str = v => (typeof v === 'string' ? v.slice(0, 300) : undefined)
const coord = (v, max) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : undefined)
export function publicPlaceData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const k of TEXT_KEYS) if (str(raw[k]) !== undefined) out[k] = str(raw[k])
  const c = raw.category
  if (typeof c === 'string') out.category = str(c)
  else if (c && typeof c === 'object' && !Array.isArray(c)) {
    out.category = {}
    if (str(c.key) !== undefined) out.category.key = str(c.key)
    if (str(c.label) !== undefined) out.category.label = str(c.label)
  }
  for (const [k, max] of [['lat', 90], ['lng', 180], ['lon', 180]]) if (coord(raw[k], max) !== undefined) out[k] = raw[k]
  if (raw.tags && typeof raw.tags === 'object' && !Array.isArray(raw.tags)) {
    const tags = {}
    for (const k of TAG_KEYS) if (str(raw.tags[k]) !== undefined) tags[k] = str(raw.tags[k])
    if (Object.keys(tags).length) out.tags = tags
  }
  return out
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'places:trending')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const { limit = 10, days = 30 } = req.query

    // Apply bounds to prevent abuse
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 10), 50)
    const safeDays = Math.min(Math.max(1, parseInt(days) || 30), 90)

    // Get places with recent activity from any source (contributions, saves,
    // visits). Weighted scoring: contributions are strongest signal (someone
    // wrote about it), visits next (someone went), saves last (someone wants
    // to go). Default window 30 days — short enough to feel current, long
    // enough to populate in low-volume product life.
    const sql = `
      SELECT
        combined.place_id,
        SUM(combined.contribution_score) as contribution_count,
        SUM(combined.save_score) as save_count,
        SUM(combined.visit_score) as visit_count,
        SUM(combined.weight) as popularity_score,
        MAX(combined.activity_at) as last_activity
      FROM (
        SELECT place_id, 1 as contribution_score, 0 as save_score, 0 as visit_score, 3 as weight, created_at as activity_at
        FROM contributions
        WHERE status = 'approved' AND visibility = 'public' AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
        UNION ALL
        SELECT place_id, 0, 1, 0, 1, saved_at FROM saved_places
        WHERE saved_at > DATE_SUB(NOW(), INTERVAL ? DAY)
        UNION ALL
        SELECT place_id, 0, 0, 1, 2, visited_at FROM visited_places
        WHERE visited_at > DATE_SUB(NOW(), INTERVAL ? DAY)
      ) combined
      GROUP BY combined.place_id
      HAVING popularity_score > 0
      ORDER BY popularity_score DESC, last_activity DESC
      LIMIT ?
    `

    const trending = await memoized(`rank:${safeDays}:${safeLimit}`, () => query(sql, [safeDays, safeDays, safeDays, safeLimit]))

    // Get top contribution content for each trending place
    const placeIds = trending.map(t => t.place_id)

    // Optional auth — when signed in, exclude the viewer's blocked users
    // from the top-tip subtitle so they don't see a blocked author's
    // username/display_name on a trending card.
    const currentUser = await getUserFromRequest(req).catch(() => null)

    let contributions = []
    let placeData = []
    let photoByPlace = {}
    if (placeIds.length > 0) {
      const placeholders = placeIds.map(() => '?').join(',')

      const blockFilter = currentUser
        ? `AND NOT EXISTS (
             SELECT 1 FROM blocked_users
             WHERE (blocker_id = ? AND blocked_id = c.user_id)
                OR (blocker_id = c.user_id AND blocked_id = ?)
           )`
        : ''

      // Fetch top tip contributions (used for the card subtitle)
      // Same visibility rule as GET /api/contributions and /batch: anonymous
      // viewers see public contributions; signed-in viewers also see their own
      // and followers_only ones from people they follow. private only ever
      // reaches its author.
      const visibilityFilter = currentUser
        ? `AND (
             c.visibility = 'public'
             OR c.user_id = ?
             OR (c.visibility = 'followers_only' AND EXISTS (
               SELECT 1 FROM follows WHERE follower_id = ? AND following_id = c.user_id
             ))
           )`
        : `AND c.visibility = 'public'`
      const viewerParams = currentUser ? [currentUser.id, currentUser.id, currentUser.id, currentUser.id] : []

      contributions = await query(
        `SELECT
          c.place_id,
          c.content,
          c.upvotes,
          c.downvotes,
          u.username,
          u.display_name
        FROM contributions c
        JOIN users u ON c.user_id = u.id
        WHERE c.place_id IN (${placeholders})
          AND c.contribution_type = 'tip'
          AND c.status = 'approved'
          AND u.is_banned = FALSE
          ${visibilityFilter}
          ${blockFilter}
        ORDER BY (c.upvotes - c.downvotes) DESC`,
        [...placeIds, ...viewerParams]
      )

      // Fetch top user-uploaded photo per place. Real user photos beat
      // Wikipedia thumbnails which beat stylized placeholders. Picks
      // the most-recent approved photo contribution per place. Same
      // block filter as the tips query — blocked user's photo should
      // not become the card hero image.
      const photoRows = await query(
        `SELECT c.place_id, c.metadata, c.created_at
         FROM contributions c
         JOIN users u ON c.user_id = u.id
         WHERE c.place_id IN (${placeholders})
           AND c.contribution_type = 'photo'
           AND c.status = 'approved'
           AND u.is_banned = FALSE
           ${visibilityFilter}
           ${blockFilter}
         ORDER BY c.created_at DESC`,
        [...placeIds, ...viewerParams]
      )
      for (const row of photoRows) {
        if (photoByPlace[row.place_id]) continue // most recent first; skip rest
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
          const url = meta?.photoUrl || meta?.url
          if (url) photoByPlace[row.place_id] = url
        } catch {
          // Skip rows with malformed metadata JSON
        }
      }

      // Fetch place data from saved_places OR visited_places — visits write
      // place_data too and might be the only source for a trending place
      // that nobody has saved yet.
      placeData = await memoized(`data:${JSON.stringify(placeIds)}`, () => query(
        `SELECT place_id, place_data FROM (
          SELECT place_id, place_data, saved_at as activity_at FROM saved_places
          WHERE place_id IN (${placeholders}) AND place_data IS NOT NULL
          UNION ALL
          SELECT place_id, place_data, visited_at as activity_at FROM visited_places
          WHERE place_id IN (${placeholders}) AND place_data IS NOT NULL
        ) all_data
        GROUP BY place_id`,
        [...placeIds, ...placeIds]
      ))
    }

    // Group contributions by place
    const contributionsByPlace = {}
    for (const c of contributions) {
      if (!contributionsByPlace[c.place_id]) {
        contributionsByPlace[c.place_id] = c
      }
    }

    // Map place data by place_id
    const placeDataByPlace = {}
    for (const p of placeData) {
      try {
        const data = typeof p.place_data === 'string' ? JSON.parse(p.place_data) : p.place_data
        placeDataByPlace[p.place_id] = publicPlaceData(data)
      } catch {
        // Skip invalid JSON
      }
    }

    const result = trending.map(t => {
      const place = placeDataByPlace[t.place_id]
      // Inject the top user-uploaded photo URL into placeData.image so
      // PlaceImage's resolution chain picks it up first — real human
      // photos take precedence over Wikipedia thumbnails over the
      // stylized placeholder.
      const userPhoto = photoByPlace[t.place_id]
      const placeWithPhoto = (place || userPhoto)
        ? { ...(place || {}), ...(userPhoto ? { image: userPhoto } : {}) }
        : null
      return {
        placeId: t.place_id,
        placeName: place?.name || null,
        placeCategory: place?.category?.label || place?.type || null,
        // Full placeData so the client can render proper imagery
        // (PlaceImage needs the wikipedia/wikidata tags for the
        // Wikipedia thumbnail fallback chain).
        placeData: placeWithPhoto,
        contributionCount: Number(t.contribution_count) || 0,
        saveCount: Number(t.save_count) || 0,
        visitCount: Number(t.visit_count) || 0,
        popularityScore: Number(t.popularity_score) || 0,
        topTip: contributionsByPlace[t.place_id] ? {
          content: contributionsByPlace[t.place_id].content,
          username: contributionsByPlace[t.place_id].username,
          displayName: contributionsByPlace[t.place_id].display_name
        } : null
      }
    })

    // Cache trending at the edge for 10 minutes, with 1-hour stale-while-
    // revalidate. The data is "places trending in last 30 days" — it
    // barely changes minute-to-minute. Edge cache deduplicates the
    // moderately-heavy UNION ALL query across the whole user base.
    // Never shared at the edge: the top-tip subtitle is filtered by the
    // viewer's blocked users, and the CDN would serve a cached anonymous copy
    // to a signed-in web user (cookie auth isn't part of the cache key) before
    // this code runs, skipping their block list.
    res.setHeader('Cache-Control', 'private, max-age=120')
    return res.status(200).json({
      trending: result,
      period: `${days} days`
    })
  } catch (error) {
    console.error('Trending places error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export default withCors(handler)
