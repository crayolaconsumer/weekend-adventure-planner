/**
 * POST /api/partners/quote
 *
 * Returns a server-authoritative flat-fee price quote for a promotion, so the
 * portal wizard can show the cost before the partner commits. The price the
 * partner is actually charged is recomputed independently at checkout.
 */

import { requireAuth } from '../lib/auth.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { isFeatureEnabled } from '../lib/flags.js'
import { quotePromotion, ALLOWED_RADII_KM, PROMO_PRICING } from '../lib/promoPricing.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_GENERAL, 'partners:quote')
  if (rateLimitError) return res.status(rateLimitError.status).json(rateLimitError)

  if (!(await isFeatureEnabled('promotedEvents'))) {
    return res.status(503).json({ error: 'Partner platform is temporarily unavailable' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  const { radiusKm, promo_starts_on, promo_ends_on } = req.body || {}
  const quote = quotePromotion({ radiusKm, startOn: promo_starts_on, endOn: promo_ends_on })

  if (!quote.valid) {
    return res.status(400).json({ error: quote.message })
  }

  return res.status(200).json({
    quote,
    options: { allowedRadiiKm: ALLOWED_RADII_KM, pricing: PROMO_PRICING }
  })
}

export default withCors(handler)
