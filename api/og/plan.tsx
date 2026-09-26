/**
 * GET /api/og/plan?code=
 * Link-preview image for a shared plan: title, author, first stops.
 * Look and runtime: see api/lib/ogCard.js.
 */
import { sendCard } from '../lib/ogCard.js'
import { query, queryOne } from '../lib/db.js'
import { validateShareCode } from '../lib/validation.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

export const config = { runtime: 'nodejs' }

const stopName = row => {
  try { return JSON.parse(row.place_data)?.name || null } catch { return null }
}

export default async function handler(req, res) {
  const limited = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'og')
  if (limited) return res.status(429).end()
  const code = req.query?.code
  try {
    const plan = validateShareCode(code).valid && await queryOne(
      `SELECT p.id, p.title, u.username FROM plans p JOIN users u ON p.user_id = u.id
       WHERE p.share_code = ? AND p.is_public = 1 AND u.is_banned = FALSE`,
      [code]
    )
    if (!plan) return await sendCard(res, { title: 'Plan a day out with ROAM', subtitle: 'Find places, build a route, go' }, { sMaxAge: 600 })
    const stops = await query('SELECT place_data FROM plan_stops WHERE plan_id = ? ORDER BY sort_order ASC', [plan.id])
    return await sendCard(res, {
      title: plan.title,
      subtitle: `${stops.length ? `${stops.length}-stop day out` : 'Day out'} by @${plan.username}`,
      list: stops.map(stopName).filter(Boolean)
    })
  } catch (err) {
    console.error('[og/plan]', err.message)
    return res.status(500).end()
  }
}
