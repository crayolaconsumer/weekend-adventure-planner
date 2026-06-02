/**
 * GET /api/flags
 *
 * Returns the current runtime feature flags (server-side kill-switch state).
 * Every feature defaults to ENABLED; the flags only ever turn things off.
 *
 * Edge-cached for 30s (stale-while-revalidate 60s) — the same window as the
 * in-memory cache in lib/flags.js — so a kill-switch change propagates within
 * about a minute without a deploy.
 */

import { withCors } from './lib/cors.js'
import { getFlags } from './lib/flags.js'

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // getFlags never throws (fails open to defaults), so no try/catch needed.
  const flags = await getFlags()

  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res.status(200).json({ flags })
}

export default withCors(handler)
