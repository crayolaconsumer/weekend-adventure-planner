/**
 * GET/POST/DELETE /api/contributions
 *
 * Manage place contributions (tips, stories, etc.)
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert, update, transaction } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { validateContent, validateId } from '../lib/validation.js'
import { notifyContributionUpvote, notifyContributionRemoved } from '../lib/pushNotifications.js'
import { waitUntil } from '@vercel/functions'
import { evaluateBadges } from '../users/badges.js'
import { withCors } from '../lib/cors.js'

// Safe JSON parse helper
const safeJsonParse = (data, defaultValue = null) => {
  if (!data) return defaultValue
  if (typeof data === 'object') return data
  try {
    return JSON.parse(data)
  } catch {
    return defaultValue
  }
}

async function handler(req, res) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res)
      case 'POST':
        // Route based on action field
        if (req.body?.action === 'vote') {
          return await handleVote(req, res)
        }
        return await handlePost(req, res)
      case 'DELETE':
        return await handleDelete(req, res)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Contributions error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Get contributions for a place or user
 * Query params:
 *   - placeId: Get contributions for a specific place
 *   - userId: Get contributions by a specific user
 *   - limit: Max results (default 20)
 */
async function handleGet(req, res) {
  const { placeId, userId, limit = 20 } = req.query
  const currentUser = await getUserFromRequest(req)

  // Validate pagination bounds
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100)

  let sql = `
    SELECT
      c.id,
      c.place_id,
      c.contribution_type,
      c.content,
      c.metadata,
      c.upvotes,
      c.downvotes,
      c.created_at,
      c.place_name,
      c.place_category,
      c.place_image_url,
      u.id as user_id,
      u.username,
      u.display_name,
      u.avatar_url
  `

  // If user is logged in, also get their vote status
  if (currentUser) {
    sql += `,
      (SELECT vote_type FROM contribution_votes WHERE user_id = ? AND contribution_id = c.id) as user_vote
    `
  }

  sql += `
    FROM contributions c
    JOIN users u ON c.user_id = u.id
    WHERE (c.status = 'approved'`

  const params = currentUser ? [currentUser.id] : []

  // Pending contributions are only visible to their author
  if (currentUser) {
    sql += ` OR (c.status = 'pending' AND c.user_id = ?)`
    params.push(currentUser.id)
  }
  sql += `)`

  // Hide contributions by banned authors from everyone except the
  // author themselves (so banned users can still see their own data
  // for the GDPR-mandated export/delete flows).
  if (currentUser) {
    sql += ` AND (u.is_banned = FALSE OR c.user_id = ?)`
    params.push(currentUser.id)
  } else {
    sql += ` AND u.is_banned = FALSE`
  }

  // Enforce visibility rules
  // - public: visible to everyone
  // - followers_only: visible to author and their followers
  // - private: only visible to author
  if (currentUser) {
    sql += ` AND (
      c.visibility = 'public'
      OR c.user_id = ?
      OR (c.visibility = 'followers_only' AND EXISTS (
        SELECT 1 FROM follows WHERE follower_id = ? AND following_id = c.user_id
      ))
    )`
    params.push(currentUser.id, currentUser.id)

    // Hide content from / to users the viewer has blocked (bidirectional).
    // Block previously only stopped follows / DMs / profile views — tips
    // and reviews on place detail still leaked from blocked authors to
    // the blocker. That breaks the user's expectation when they tap Block.
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM blocked_users
      WHERE (blocker_id = ? AND blocked_id = c.user_id)
         OR (blocker_id = c.user_id AND blocked_id = ?)
    )`
    params.push(currentUser.id, currentUser.id)
  } else {
    // Anonymous users can only see public contributions
    sql += ` AND c.visibility = 'public'`
  }

  if (placeId) {
    sql += ' AND c.place_id = ?'
    params.push(placeId)
  }

  if (userId) {
    sql += ' AND c.user_id = ?'
    params.push(parseInt(userId, 10))
  }

  // Order by score (upvotes - downvotes), then by date
  sql += ' ORDER BY (c.upvotes - c.downvotes) DESC, c.created_at DESC'
  sql += ' LIMIT ?'
  params.push(safeLimit)

  const contributions = await query(sql, params)

  // Format response. IDs stay numeric because the vote/moderation
  // endpoints key on them — only the virtual review rows added below
  // get a `review_` prefix to keep them keyable in React without
  // colliding with real contribution ids.
  const formatted = contributions.map(c => ({
    id: c.id,
    placeId: c.place_id,
    type: c.contribution_type,
    content: c.content,
    metadata: safeJsonParse(c.metadata),
    upvotes: c.upvotes,
    downvotes: c.downvotes,
    score: c.upvotes - c.downvotes,
    createdAt: new Date(c.created_at).toISOString(),
    placeName: c.place_name || null,
    placeCategory: c.place_category || null,
    placeImageUrl: c.place_image_url || null,
    user: {
      id: c.user_id,
      username: c.username,
      displayName: c.display_name,
      avatarUrl: c.avatar_url
    },
    userVote: c.user_vote || null
  }))

  // For place-scoped queries we ALSO surface the reviews left via the
  // ratings flow (place_ratings.review). Reviews were previously only
  // visible to the author via PlaceReviews; surfacing them here lets
  // every viewer see what other users actually wrote about a place,
  // and lets the client merge a user's rating + tip + photo into a
  // single visible entry per user instead of three orphaned rows.
  if (placeId) {
    try {
      let reviewSql = `
        SELECT
          pr.id,
          pr.place_id,
          pr.rating,
          pr.review,
          pr.created_at,
          pr.updated_at,
          u.id as user_id,
          u.username,
          u.display_name,
          u.avatar_url
        FROM place_ratings pr
        JOIN users u ON pr.user_id = u.id
        WHERE pr.place_id = ?
          AND pr.review IS NOT NULL
          AND TRIM(pr.review) <> ''
          AND u.is_banned = FALSE
      `
      const reviewParams = [placeId]

      // Privacy: hide reviews from users who blocked the viewer (or
      // are blocked by the viewer). No-op for anonymous viewers.
      if (currentUser) {
        reviewSql += ` AND NOT EXISTS (
          SELECT 1 FROM blocked_users
          WHERE (blocker_id = ? AND blocked_id = pr.user_id)
             OR (blocker_id = pr.user_id AND blocked_id = ?)
        )`
        reviewParams.push(currentUser.id, currentUser.id)
      }
      reviewSql += ' ORDER BY pr.updated_at DESC LIMIT ?'
      reviewParams.push(safeLimit)

      const reviews = await query(reviewSql, reviewParams)
      for (const r of reviews) {
        formatted.push({
          id: `review_${r.id}`,
          placeId: r.place_id,
          type: 'review',
          content: r.review,
          metadata: null,
          // Reviews don't participate in the contribution-vote system.
          upvotes: 0,
          downvotes: 0,
          score: 0,
          // Carry the rating along so the client can render a
          // recommendation badge alongside the review text.
          rating: r.rating,
          createdAt: new Date(r.updated_at || r.created_at).toISOString(),
          placeName: null,
          placeCategory: null,
          placeImageUrl: null,
          user: {
            id: r.user_id,
            username: r.username,
            displayName: r.display_name,
            avatarUrl: r.avatar_url
          },
          userVote: null
        })
      }
    } catch (err) {
      // Reviews are a best-effort enrichment — never break the
      // contributions response if the join hits a transient error.
      console.warn('Review enrichment failed', err)
    }
  }

  return res.status(200).json({ contributions: formatted })
}

/**
 * POST - Create a new contribution
 * Body: { placeId, type, content, metadata?, placeName?, placeCategory?, placeImageUrl? }
 */
async function handlePost(req, res) {
  // Rate limit contribution creation
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.CONTRIBUTION, 'contrib:create')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  // Require authentication
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { placeId, type, content, metadata, visibility, placeName, placeCategory, placeImageUrl } = req.body

  // Validate visibility
  const validVisibility = ['public', 'followers_only', 'private']
  const safeVisibility = validVisibility.includes(visibility) ? visibility : 'public'

  // Validate required fields. Photo contributions can have an empty
  // caption — the uploaded image itself IS the contribution — so we
  // only require content for tip/correction/story types. The previous
  // strict check forced the client to send "Photo contribution" as
  // placeholder text, which then leaked into every public feed.
  if (!placeId || !type) {
    return res.status(400).json({ error: 'placeId and type are required' })
  }

  // Validate type
  const validTypes = ['tip', 'photo', 'correction', 'story']
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
  }

  const isPhoto = type === 'photo'
  const hasPhotoUrl = !!(metadata && typeof metadata === 'object' && metadata.photoUrl)
  if (isPhoto && !hasPhotoUrl) {
    return res.status(400).json({ error: 'Photo contributions require metadata.photoUrl' })
  }
  if (!isPhoto && (!content || !String(content).trim())) {
    return res.status(400).json({ error: 'content is required' })
  }

  // Validate content if present. Photo captions are optional but if
  // supplied they're still length-checked.
  const trimmedContent = content ? String(content) : ''
  if (trimmedContent) {
    const maxLength = type === 'story' ? 1000 : 280
    const contentValidation = validateContent(trimmedContent, maxLength)
    if (!contentValidation.valid) {
      return res.status(400).json({ error: contentValidation.message })
    }
  }

  // Sanitize place context fields
  const sanitizedPlaceName = placeName ? String(placeName).slice(0, 255) : null
  const sanitizedPlaceCategory = placeCategory ? String(placeCategory).slice(0, 100) : null
  const sanitizedPlaceImageUrl = placeImageUrl ? String(placeImageUrl).slice(0, 500) : null

  // Check for duplicate contribution (same user, same place, within 24 hours)
  const existing = await queryOne(
    `SELECT id FROM contributions
     WHERE user_id = ? AND place_id = ? AND contribution_type = ?
     AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [user.id, placeId, type]
  )

  if (existing) {
    return res.status(409).json({ error: 'You already contributed to this place recently' })
  }

  // Auto-approve on insert. Pre-publish AI moderation is too expensive
  // at scale, and a manual approval queue would gate every tip behind
  // operator action. Instead: tips go live immediately, and the
  // community + report flow handles takedown. Downvote threshold in
  // handleVote auto-rejects content that the community clearly dislikes;
  // explicit reports route through api/moderation/report.js which can
  // flip status to 'rejected' for offensive content.
  // For photo contributions with no caption, we store an empty string
  // (not the old "Photo contribution" sentinel and not NULL, since the
  // existing column was created NOT NULL). The display layer treats
  // an empty string as "no caption" and only renders the image.
  const dbContent = trimmedContent
  let insertId
  try {
    insertId = await insert(
      `INSERT INTO contributions (user_id, place_id, contribution_type, content, metadata, status, visibility, place_name, place_category, place_image_url)
       VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
      [user.id, placeId, type, dbContent, metadata ? JSON.stringify(metadata) : null, safeVisibility, sanitizedPlaceName, sanitizedPlaceCategory, sanitizedPlaceImageUrl]
    )
  } catch (err) {
    // Fallback: place context columns might not exist yet
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      insertId = await insert(
        `INSERT INTO contributions (user_id, place_id, contribution_type, content, metadata, status, visibility)
         VALUES (?, ?, ?, ?, ?, 'approved', ?)`,
        [user.id, placeId, type, dbContent, metadata ? JSON.stringify(metadata) : null, safeVisibility]
      )
    } else {
      throw err
    }
  }

  // Re-evaluate every stats-derived badge for this user. Replaces the
  // previous if-count-equals pattern which would silently miss a badge
  // if the user crossed a threshold via a different path (e.g. they
  // also crossed visits_10 with the same action, or they had a
  // contribution approved later and crossed contributor_10 then but
  // we only checked at insert). evaluateBadges queries source-of-truth
  // tables (counts only `approved` contributions, so spammers don't
  // earn contributor_*).
  waitUntil(
    evaluateBadges(user.id).catch(err =>
      console.error('[badges] evaluateBadges after contribution failed', {
        userId: user.id, err: err?.message || String(err)
      })
    )
  )

  return res.status(201).json({
    success: true,
    contribution: {
      id: insertId,
      placeId,
      type,
      content: dbContent,
      metadata: metadata || null,
      placeName: sanitizedPlaceName,
      placeCategory: sanitizedPlaceCategory,
      placeImageUrl: sanitizedPlaceImageUrl,
      upvotes: 0,
      downvotes: 0,
      score: 0,
      createdAt: new Date().toISOString(),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url
      },
      userVote: null
    }
  })
}

/**
 * POST with action='vote' - Vote on a contribution
 * Body: { action: 'vote', contributionId, voteType: 'up' | 'down' | null }
 */
async function handleVote(req, res) {
  // Rate limit voting
  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.VOTE, 'contrib:vote')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  // Require authentication
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { contributionId, voteType } = req.body

  // Validate required fields
  const idValidation = validateId(contributionId)
  if (!idValidation.valid) {
    return res.status(400).json({ error: 'Invalid contributionId' })
  }

  // Validate vote type (null to remove vote)
  if (voteType !== null && voteType !== 'up' && voteType !== 'down') {
    return res.status(400).json({ error: 'voteType must be "up", "down", or null' })
  }

  // Get the contribution
  const contribution = await queryOne(
    'SELECT id, upvotes, downvotes, user_id, place_id, place_name FROM contributions WHERE id = ?',
    [contributionId]
  )

  if (!contribution) {
    return res.status(404).json({ error: 'Contribution not found' })
  }

  // Can't vote on your own contribution
  if (contribution.user_id === user.id) {
    return res.status(403).json({ error: 'Cannot vote on your own contribution' })
  }

  // Check existing vote
  const existingVote = await queryOne(
    'SELECT vote_type FROM contribution_votes WHERE user_id = ? AND contribution_id = ?',
    [user.id, contributionId]
  )

  // Use atomic SQL updates to prevent race conditions
  // (two simultaneous votes would otherwise lose one)
  if (voteType === null) {
    // Remove vote
    if (existingVote) {
      await update(
        'DELETE FROM contribution_votes WHERE user_id = ? AND contribution_id = ?',
        [user.id, contributionId]
      )

      // Atomic decrement
      if (existingVote.vote_type === 'up') {
        await update(
          'UPDATE contributions SET upvotes = GREATEST(0, upvotes - 1) WHERE id = ?',
          [contributionId]
        )
      } else {
        await update(
          'UPDATE contributions SET downvotes = GREATEST(0, downvotes - 1) WHERE id = ?',
          [contributionId]
        )
      }
    }
  } else if (existingVote) {
    // Update existing vote
    if (existingVote.vote_type !== voteType) {
      await update(
        'UPDATE contribution_votes SET vote_type = ? WHERE user_id = ? AND contribution_id = ?',
        [voteType, user.id, contributionId]
      )

      // Atomic swap vote counts
      if (voteType === 'up') {
        await update(
          'UPDATE contributions SET upvotes = upvotes + 1, downvotes = GREATEST(0, downvotes - 1) WHERE id = ?',
          [contributionId]
        )
      } else {
        await update(
          'UPDATE contributions SET downvotes = downvotes + 1, upvotes = GREATEST(0, upvotes - 1) WHERE id = ?',
          [contributionId]
        )
      }
    }
    // If same vote type, do nothing
  } else {
    // New vote
    await insert(
      'INSERT INTO contribution_votes (user_id, contribution_id, vote_type) VALUES (?, ?, ?)',
      [user.id, contributionId, voteType]
    )

    // Atomic increment
    if (voteType === 'up') {
      await update(
        'UPDATE contributions SET upvotes = upvotes + 1 WHERE id = ?',
        [contributionId]
      )
    } else {
      await update(
        'UPDATE contributions SET downvotes = downvotes + 1 WHERE id = ?',
        [contributionId]
      )
    }
  }

  // Re-read final counts for response (atomic reads are fine)
  const updated = await queryOne(
    'SELECT upvotes, downvotes FROM contributions WHERE id = ?',
    [contributionId]
  )
  const newUpvotes = updated?.upvotes || 0
  const newDownvotes = updated?.downvotes || 0

  // Community-driven auto-removal. Tips are auto-approved at submit
  // time (no AI gate, no manual queue), so the downvote system is the
  // primary defence against bad content. Threshold requires both real
  // consensus AND a net negative — a controversial-but-popular tip
  // (10 up / 8 down) survives, a clearly-disliked one (1 up / 6 down)
  // disappears. Tune DOWNVOTE_FLOOR / NET_NEGATIVE if needed.
  const DOWNVOTE_FLOOR = 5
  const NET_NEGATIVE = 3
  if (
    voteType === 'down' &&
    newDownvotes >= DOWNVOTE_FLOOR &&
    (newDownvotes - newUpvotes) >= NET_NEGATIVE
  ) {
    // update() returns affectedRows directly. The WHERE status='approved'
    // guard means subsequent downvotes after auto-removal return 0, so
    // we notify exactly once per removal — no spam if the tip keeps
    // getting downvoted while already hidden.
    const affectedRows = await update(
      `UPDATE contributions SET status = 'rejected' WHERE id = ? AND status = 'approved'`,
      [contributionId]
    )
    if (affectedRows === 1) {
      const placeName = contribution.place_name || 'a place'
      waitUntil(
        notifyContributionRemoved(contribution.user_id, placeName)
          .catch(err => console.error('[push] notifyContributionRemoved failed', {
            userId: contribution.user_id,
            err: err?.message || String(err)
          }))
      )
    }
  }

  // Send push notification for upvotes (kept alive past response via
  // waitUntil). Only notify on milestone upvote counts to avoid spam.
  if (voteType === 'up' && [1, 5, 10, 25, 50, 100].includes(newUpvotes)) {
    // Use the human place_name we stamped at contribution time, not
    // place_id (a UUID/OSM ID — produces garbage in the notification
    // body like "Your tip about node/12345 has 5 upvotes").
    const placeName = contribution.place_name || 'a place'
    waitUntil(
      notifyContributionUpvote(contribution.user_id, placeName, newUpvotes)
        .catch(err => console.error('[push] notifyContributionUpvote failed', {
          userId: contribution.user_id,
          err: err?.message || String(err)
        }))
    )
  }

  // Re-evaluate badges for the contribution AUTHOR — an upvote on
  // their tip may have crossed the helpful_10 / helpful_50 thresholds.
  // Fires on every vote (not just milestones) because evaluateBadges
  // is cheap and idempotent.
  if (voteType === 'up' || voteType === 'down') {
    waitUntil(
      evaluateBadges(contribution.user_id).catch(err =>
        console.error('[badges] evaluateBadges after vote failed', {
          userId: contribution.user_id, err: err?.message || String(err)
        })
      )
    )
  }

  return res.status(200).json({
    success: true,
    upvotes: newUpvotes,
    downvotes: newDownvotes,
    score: newUpvotes - newDownvotes,
    userVote: voteType
  })
}

/**
 * DELETE - Delete a contribution
 * Query params: { contributionId }
 */
async function handleDelete(req, res) {
  // Require authentication
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { contributionId } = req.query

  if (!contributionId) {
    return res.status(400).json({ error: 'contributionId is required' })
  }

  const id = parseInt(contributionId, 10)
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid contributionId' })
  }

  // Get the contribution
  const contribution = await queryOne(
    'SELECT id, user_id FROM contributions WHERE id = ?',
    [id]
  )

  if (!contribution) {
    return res.status(404).json({ error: 'Contribution not found' })
  }

  // Only the owner can delete their contribution
  if (contribution.user_id !== user.id) {
    return res.status(403).json({ error: 'You can only delete your own contributions' })
  }

  // Delete contribution and associated votes atomically
  await transaction(async (conn) => {
    await conn.query('DELETE FROM contribution_votes WHERE contribution_id = ?', [id])
    await conn.query('DELETE FROM contributions WHERE id = ?', [id])
  })

  return res.status(200).json({ success: true })
}

export default withCors(handler)
