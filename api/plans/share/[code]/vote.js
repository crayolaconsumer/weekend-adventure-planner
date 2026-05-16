/**
 * POST /api/plans/share/:code/vote
 *
 * Co-planning vote endpoint. Lets an authenticated viewer of a shared
 * plan vote up/down on individual stops. One vote per user per stop —
 * re-voting on the same stop toggles or changes the vote type. Voting
 * is only allowed against PUBLIC plans (is_public = 1) and only on
 * stops that belong to the plan identified by the share code.
 *
 * Why auth-required: anonymous + cookie/session voting is too easy to
 * spam (clear cookies, vote again) and the votes are visible to the
 * plan owner, so we want a real account behind each one.
 *
 * Request body: { stopId: number, voteType: 'up' | 'down' | null }
 *   - voteType: null deletes the user's existing vote on this stop.
 *
 * Response: { votes: { up: number, down: number }, yourVote: 'up'|'down'|null }
 */

import { getUserFromRequest } from '../../../lib/auth.js'
import { query, queryOne, insert } from '../../../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../../../lib/rateLimit.js'
import { validateShareCode } from '../../../lib/validation.js'
import { withCors } from '../../../lib/cors.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'plan-vote')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  const { code } = req.query
  const codeValidation = validateShareCode(code)
  if (!codeValidation.valid) {
    return res.status(400).json({ error: codeValidation.message })
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Sign in to vote on a plan' })
  }

  const { stopId, voteType } = req.body || {}
  const parsedStopId = parseInt(stopId, 10)
  if (!Number.isFinite(parsedStopId)) {
    return res.status(400).json({ error: 'stopId required' })
  }
  if (voteType !== null && voteType !== 'up' && voteType !== 'down') {
    return res.status(400).json({ error: "voteType must be 'up', 'down' or null" })
  }

  try {
    // Verify the stop actually belongs to a public plan identified by
    // this share code. Single query covers existence + auth.
    const stop = await queryOne(
      `SELECT ps.id, ps.plan_id
       FROM plan_stops ps
       JOIN plans p ON p.id = ps.plan_id
       WHERE ps.id = ? AND p.share_code = ? AND p.is_public = 1`,
      [parsedStopId, code]
    )
    if (!stop) {
      return res.status(404).json({ error: 'Stop not found on this plan' })
    }

    if (voteType === null) {
      // Delete any existing vote
      await query(
        `DELETE FROM plan_stop_votes
         WHERE plan_id = ? AND stop_id = ? AND voter_user_id = ?`,
        [stop.plan_id, parsedStopId, user.id]
      )
    } else {
      // Upsert: insert or update existing on (plan_id, stop_id, voter_user_id)
      const existing = await queryOne(
        `SELECT id, vote_type FROM plan_stop_votes
         WHERE plan_id = ? AND stop_id = ? AND voter_user_id = ?`,
        [stop.plan_id, parsedStopId, user.id]
      )
      if (existing) {
        if (existing.vote_type !== voteType) {
          await query(
            `UPDATE plan_stop_votes SET vote_type = ? WHERE id = ?`,
            [voteType, existing.id]
          )
        }
      } else {
        await insert(
          `INSERT INTO plan_stop_votes (plan_id, stop_id, voter_user_id, vote_type)
           VALUES (?, ?, ?, ?)`,
          [stop.plan_id, parsedStopId, user.id, voteType]
        )
      }
    }

    // Return updated aggregate + this user's current vote
    const aggregate = await queryOne(
      `SELECT
         SUM(vote_type = 'up') AS up_count,
         SUM(vote_type = 'down') AS down_count
       FROM plan_stop_votes
       WHERE plan_id = ? AND stop_id = ?`,
      [stop.plan_id, parsedStopId]
    )

    const yourVoteRow = voteType === null ? null : await queryOne(
      `SELECT vote_type FROM plan_stop_votes
       WHERE plan_id = ? AND stop_id = ? AND voter_user_id = ?`,
      [stop.plan_id, parsedStopId, user.id]
    )

    return res.status(200).json({
      votes: {
        up: Number(aggregate?.up_count || 0),
        down: Number(aggregate?.down_count || 0),
      },
      yourVote: yourVoteRow?.vote_type || null,
    })
  } catch (error) {
    console.error('Plan vote error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export default withCors(handler)
