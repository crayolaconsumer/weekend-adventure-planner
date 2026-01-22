/**
 * GET/POST /api/contributions
 *
 * Manage place contributions (tips, stories, etc.)
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne, insert, update } from '../lib/db.js'

export default async function handler(req, res) {
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
    WHERE c.status = 'approved' OR c.status = 'pending'
  `

  const params = currentUser ? [currentUser.id] : []

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
  params.push(parseInt(limit, 10))

  const contributions = await query(sql, params)

  // Format response
  const formatted = contributions.map(c => ({
    id: c.id,
    placeId: c.place_id,
    type: c.contribution_type,
    content: c.content,
    metadata: c.metadata ? JSON.parse(c.metadata) : null,
    upvotes: c.upvotes,
    downvotes: c.downvotes,
    score: c.upvotes - c.downvotes,
    createdAt: new Date(c.created_at).toISOString(),
    user: {
      id: c.user_id,
      username: c.username,
      displayName: c.display_name,
      avatarUrl: c.avatar_url
    },
    userVote: c.user_vote || null
  }))

  return res.status(200).json({ contributions: formatted })
}

/**
 * POST - Create a new contribution
 * Body: { placeId, type, content, metadata? }
 */
async function handlePost(req, res) {
  // Require authentication
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { placeId, type, content, metadata } = req.body

  // Validate required fields
  if (!placeId || !type || !content) {
    return res.status(400).json({ error: 'placeId, type, and content are required' })
  }

  // Validate type
  const validTypes = ['tip', 'photo', 'correction', 'story']
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
  }

  // Validate content length (max 280 chars for tips, longer for stories)
  const maxLength = type === 'story' ? 1000 : 280
  if (content.length > maxLength) {
    return res.status(400).json({ error: `Content too long. Max ${maxLength} characters.` })
  }

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

  // Insert contribution (auto-approve for now, add moderation later)
  const id = await insert(
    `INSERT INTO contributions (user_id, place_id, contribution_type, content, metadata, status)
     VALUES (?, ?, ?, ?, ?, 'approved')`,
    [user.id, placeId, type, content, metadata ? JSON.stringify(metadata) : null]
  )

  return res.status(201).json({
    success: true,
    contribution: {
      id,
      placeId,
      type,
      content,
      metadata: metadata || null,
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
  // Require authentication
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const { contributionId, voteType } = req.body

  // Validate required fields
  if (!contributionId) {
    return res.status(400).json({ error: 'contributionId is required' })
  }

  // Validate vote type (null to remove vote)
  if (voteType !== null && voteType !== 'up' && voteType !== 'down') {
    return res.status(400).json({ error: 'voteType must be "up", "down", or null' })
  }

  // Get the contribution
  const contribution = await queryOne(
    'SELECT id, upvotes, downvotes, user_id FROM contributions WHERE id = ?',
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

  let newUpvotes = contribution.upvotes
  let newDownvotes = contribution.downvotes

  if (voteType === null) {
    // Remove vote
    if (existingVote) {
      await update(
        'DELETE FROM contribution_votes WHERE user_id = ? AND contribution_id = ?',
        [user.id, contributionId]
      )

      // Adjust counts
      if (existingVote.vote_type === 'up') {
        newUpvotes = Math.max(0, newUpvotes - 1)
      } else {
        newDownvotes = Math.max(0, newDownvotes - 1)
      }
    }
  } else if (existingVote) {
    // Update existing vote
    if (existingVote.vote_type !== voteType) {
      await update(
        'UPDATE contribution_votes SET vote_type = ? WHERE user_id = ? AND contribution_id = ?',
        [voteType, user.id, contributionId]
      )

      // Swap vote counts
      if (voteType === 'up') {
        newUpvotes += 1
        newDownvotes = Math.max(0, newDownvotes - 1)
      } else {
        newDownvotes += 1
        newUpvotes = Math.max(0, newUpvotes - 1)
      }
    }
    // If same vote type, do nothing
  } else {
    // New vote
    await insert(
      'INSERT INTO contribution_votes (user_id, contribution_id, vote_type) VALUES (?, ?, ?)',
      [user.id, contributionId, voteType]
    )

    if (voteType === 'up') {
      newUpvotes += 1
    } else {
      newDownvotes += 1
    }
  }

  // Update contribution vote counts
  await update(
    'UPDATE contributions SET upvotes = ?, downvotes = ? WHERE id = ?',
    [newUpvotes, newDownvotes, contributionId]
  )

  return res.status(200).json({
    success: true,
    upvotes: newUpvotes,
    downvotes: newDownvotes,
    score: newUpvotes - newDownvotes,
    userVote: voteType
  })
}
