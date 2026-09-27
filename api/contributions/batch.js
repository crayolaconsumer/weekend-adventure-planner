/**
 * GET /api/contributions/batch
 *
 * Batch fetch top contributions for multiple places.
 * Used to efficiently show tips on swipe cards without N+1 queries.
 */

import { query } from '../lib/db.js'
import { getUserFromRequest } from '../lib/auth.js'
import { applyRateLimit, RATE_LIMITS, dropRateLimitHeaders } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'

// Per-instance set of place_ids that have ANY approved tip (every visibility).
// Most swipe-deck places have no tips, so ids outside this set are answered
// null without touching MySQL. It is a superset of what any viewer can see, so
// the shortcut can never reveal a tip, only skip places that have none.
// Worst case a brand-new tip shows up to TIPPED_TTL_MS late on this instance.
// ponytail: whole set held in memory; switch to a bloom filter or per-id cache
// if distinct tipped places ever reach the hundreds of thousands.
const TIPPED_TTL_MS = 60_000
let tipped = null // { ids: Set<string>, at: number, loading?: Promise }

async function getTippedPlaceIds() {
  if (tipped && Date.now() - tipped.at < TIPPED_TTL_MS) return tipped.ids
  if (tipped?.loading) return tipped.loading
  const loading = query(
    `SELECT DISTINCT place_id FROM contributions WHERE status = 'approved' AND contribution_type = 'tip'`
  ).then(rows => {
    tipped = { ids: new Set(rows.map(r => String(r.place_id))), at: Date.now() }
    return tipped.ids
  }).catch(err => {
    tipped = null // retry next request; this request falls back to the full query
    throw err
  })
  tipped = { ids: null, at: 0, loading }
  return loading
}

/** Test hook: forget the cached set. */
export function _resetTippedCache() { tipped = null }

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Apply rate limiting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'contrib:batch')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  try {
    const { placeIds } = req.query

    if (!placeIds) {
      return res.status(400).json({ error: 'placeIds query parameter is required' })
    }

    // Parse place IDs (comma-separated)
    const ids = placeIds.split(',').map(id => id.trim()).filter(Boolean)

    if (ids.length === 0) {
      return res.status(200).json({ contributions: {} })
    }

    // Limit to prevent abuse
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 place IDs per request' })
    }

    // Optional auth — endpoint serves anonymous traffic too, but if the
    // user is signed in we strip out tips from anyone they've blocked
    // (in either direction). Without this the swipe deck would surface
    // top-tip preview text from a blocked user.
    const currentUser = await getUserFromRequest(req).catch(() => null)

    // Anonymous answers are the same for everyone: let the CDN share them.
    // Signed-in answers apply the viewer's blocks and follows: never shared.
    // Vary keeps a cached anonymous copy from being served to a request that
    // carries a token (Bearer on native, roam_token cookie on web).
    if (currentUser) {
      res.setHeader('Cache-Control', 'private, no-store')
    } else {
      dropRateLimitHeaders(res)
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      const vary = res.getHeader?.('Vary')
      res.setHeader('Vary', [vary, 'Authorization', 'Cookie'].filter(Boolean).join(', '))
    }

    const contributionsByPlace = Object.fromEntries(ids.map(id => [id, null]))

    // Only places with at least one tip reach the database.
    let queryIds = ids
    try {
      const tippedIds = await getTippedPlaceIds()
      queryIds = ids.filter(id => tippedIds.has(id))
    } catch (err) {
      console.warn('Tipped place set unavailable, querying all ids', err)
    }
    if (queryIds.length === 0) {
      return res.status(200).json({ contributions: contributionsByPlace })
    }

    const placeholders = queryIds.map(() => '?').join(',')

    const blockFilter = currentUser
      ? `AND NOT EXISTS (
           SELECT 1 FROM blocked_users
           WHERE (blocker_id = ? AND blocked_id = c.user_id)
              OR (blocker_id = c.user_id AND blocked_id = ?)
         )`
      : ''

    // Same visibility rules as GET /api/contributions: anonymous viewers see
    // public tips; signed-in viewers also see their own and followers_only
    // tips from people they follow. private tips only ever reach the author.
    const visibilityFilter = currentUser
      ? `AND (
           c.visibility = 'public'
           OR c.user_id = ?
           OR (c.visibility = 'followers_only' AND EXISTS (
             SELECT 1 FROM follows WHERE follower_id = ? AND following_id = c.user_id
           ))
         )`
      : `AND c.visibility = 'public'`

    const sql = `
      SELECT
        c.id,
        c.place_id,
        c.content,
        c.upvotes,
        c.downvotes,
        (c.upvotes - c.downvotes) as score,
        c.created_at,
        u.id as user_id,
        u.username,
        u.display_name,
        u.avatar_url,
        (SELECT COUNT(*) FROM contributions WHERE user_id = u.id AND status = 'approved') as user_contribution_count,
        (SELECT COALESCE(AVG(upvotes - downvotes), 0) FROM contributions WHERE user_id = u.id AND status = 'approved') as user_avg_score
      FROM contributions c
      JOIN users u ON c.user_id = u.id
      WHERE c.place_id IN (${placeholders})
        AND c.status = 'approved'
        AND c.contribution_type = 'tip'
        AND u.is_banned = FALSE
        ${visibilityFilter}
        ${blockFilter}
      ORDER BY c.place_id, (c.upvotes - c.downvotes) DESC, c.created_at DESC
    `

    const queryParams = currentUser
      ? [...queryIds, currentUser.id, currentUser.id, currentUser.id, currentUser.id]
      : queryIds
    const allContributions = await query(sql, queryParams)

    // Group by place_id and take only the first (highest scored) for each
    const seenPlaces = new Set()

    for (const c of allContributions) {
      if (seenPlaces.has(c.place_id)) continue
      seenPlaces.add(c.place_id)

      // Determine if user is a "trusted explorer"
      // Criteria: 5+ contributions with avg score > 2
      const isTrusted = c.user_contribution_count >= 5 && c.user_avg_score > 2

      contributionsByPlace[c.place_id] = {
        id: c.id,
        content: c.content,
        score: c.score,
        createdAt: new Date(c.created_at).toISOString(),
        user: {
          id: c.user_id,
          username: c.username,
          displayName: c.display_name,
          avatarUrl: c.avatar_url,
          isTrusted,
          contributionCount: c.user_contribution_count
        }
      }
    }

    return res.status(200).json({ contributions: contributionsByPlace })
  } catch (error) {
    console.error('Batch contributions error:', error)
    res.setHeader('Cache-Control', 'no-store') // never let the CDN keep an error
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export default withCors(handler)
