/**
 * GET /api/users/[username]/visited
 *
 * Public visited places for a user, with privacy enforcement.
 *
 * Visibility tiers (server-enforced — never trust client to filter):
 *   - Owner viewing self → full data
 *   - is_private_account=true → 404 to non-owner (don't confirm existence)
 *   - is_map_public=true → full data, even anonymous
 *   - Followers-only (default) + viewer is follower → full data
 *   - Followers-only + viewer not follower / anonymous → ABSTRACTED data
 *     (place ids/names stripped, coords perturbed within 0.5° cells)
 *
 * Default-private rule: if user has no user_privacy_settings row, treat as
 * private account. Matches the pattern in api/users/[username].js.
 */

import { getUserFromRequest } from '../../lib/auth.js'
import { query, queryOne } from '../../lib/db.js'
import { hasBlockBetween } from '../../social/block.js'
import { applyRateLimit, RATE_LIMITS } from '../../lib/rateLimit.js'

const TEASER_CELL_DEGREES = 0.5

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'users:visited:public')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { username } = req.query
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' })
  }

  try {
    const target = await queryOne(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE username = ?`,
      [username]
    )
    if (!target) {
      return res.status(404).json({ error: 'Not found' })
    }

    const viewer = await getUserFromRequest(req)
    const isOwner = viewer?.id === target.id

    // Block check (bidirectional)
    if (viewer && !isOwner) {
      const blocked = await hasBlockBetween(viewer.id, target.id)
      if (blocked) {
        return res.status(404).json({ error: 'Not found' })
      }
    }

    // Privacy settings — default to private if no row exists (opt-in to public)
    const privacy = await queryOne(
      'SELECT is_private_account, is_map_public FROM user_privacy_settings WHERE user_id = ?',
      [target.id]
    )
    const isPrivateAccount = privacy === null ? true : !!privacy.is_private_account
    const isMapPublic = privacy === null ? false : !!privacy.is_map_public

    if (!isOwner && isPrivateAccount) {
      return res.status(404).json({ error: 'Not found' })
    }

    // Follower check
    let isFollower = false
    if (viewer && !isOwner) {
      const followCheck = await queryOne(
        'SELECT 1 AS f FROM follows WHERE follower_id = ? AND following_id = ?',
        [viewer.id, target.id]
      )
      isFollower = !!followCheck
    }

    const canSeeFull = isOwner || isMapPublic || isFollower

    const rows = await query(
      `SELECT place_id, place_data, visited_at, notes, rating
       FROM visited_places
       WHERE user_id = ?
       ORDER BY visited_at DESC
       LIMIT 500`,
      [target.id]
    )

    const userMeta = {
      id: target.id,
      username: target.username,
      displayName: target.display_name,
      avatarUrl: target.avatar_url
    }

    if (canSeeFull) {
      const visited = rows.map(r => ({
        placeId: r.place_id,
        placeData: r.place_data
          ? (typeof r.place_data === 'string' ? JSON.parse(r.place_data) : r.place_data)
          : null,
        visitedAt: new Date(r.visited_at).getTime(),
        notes: r.notes,
        rating: r.rating
      }))
      return res.status(200).json({
        visibility: 'full',
        user: userMeta,
        visited,
        total: visited.length
      })
    }

    // Teaser: abstract coords. Bucket into 0.5° cells then offset within cell.
    // Preserves overall shape ("they've been many places in southern UK")
    // without leaking precise coordinates of any individual place.
    const placesAbstract = rows
      .map(r => {
        const data = r.place_data
          ? (typeof r.place_data === 'string' ? JSON.parse(r.place_data) : r.place_data)
          : null
        const lat = data?.lat
        const lng = data?.lng ?? data?.lon
        if (typeof lat !== 'number' || typeof lng !== 'number') return null
        const cellLat = Math.floor(lat / TEASER_CELL_DEGREES) * TEASER_CELL_DEGREES
        const cellLng = Math.floor(lng / TEASER_CELL_DEGREES) * TEASER_CELL_DEGREES
        return {
          lat: cellLat + Math.random() * TEASER_CELL_DEGREES,
          lng: cellLng + Math.random() * TEASER_CELL_DEGREES
        }
      })
      .filter(Boolean)

    return res.status(200).json({
      visibility: 'teaser',
      user: userMeta,
      placesAbstract,
      total: rows.length
    })
  } catch (error) {
    console.error('Public visited error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
