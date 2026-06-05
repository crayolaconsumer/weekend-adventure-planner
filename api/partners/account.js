/**
 * /api/partners/account
 *
 *   GET  -> the current user's partner account, or { partner: null }
 *   POST -> create or update the current user's partner account
 *
 * A "partner" is an ordinary ROAM user who has additionally registered a
 * partner_accounts row. No separate auth system — we reuse the user session.
 */

import { requireAuth, isValidEmail } from '../lib/auth.js'
import { queryOne, query } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import { isFeatureEnabled } from '../lib/flags.js'
import { sanitizeString } from '../lib/validation.js'

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rateLimitError = applyRateLimit(
    req, res,
    req.method === 'POST' ? RATE_LIMITS.API_WRITE : RATE_LIMITS.API_GENERAL,
    'partners:account'
  )
  if (rateLimitError) return res.status(rateLimitError.status).json(rateLimitError)

  if (!(await isFeatureEnabled('promotedEvents'))) {
    return res.status(503).json({ error: 'Partner platform is temporarily unavailable' })
  }

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    if (req.method === 'GET') {
      const partner = await getPartner(user.id)
      return res.status(200).json({ partner: partner || null })
    }

    // POST — create or update
    const orgName = sanitizeString(req.body?.org_name)
    const contactEmail = sanitizeString(req.body?.contact_email)
    const contactPhone = req.body?.contact_phone ? sanitizeString(req.body.contact_phone) : null
    const websiteUrl = req.body?.website_url ? sanitizeString(req.body.website_url) : null

    if (!orgName || orgName.length < 2 || orgName.length > 160) {
      return res.status(400).json({ error: 'Organisation name must be 2–160 characters' })
    }
    if (!isValidEmail(contactEmail)) {
      return res.status(400).json({ error: 'A valid contact email is required' })
    }
    if (contactPhone && contactPhone.length > 50) {
      return res.status(400).json({ error: 'Contact phone is too long' })
    }
    if (websiteUrl && !isValidWebsite(websiteUrl)) {
      return res.status(400).json({ error: 'Website must be a valid http(s) URL' })
    }

    const existing = await getPartner(user.id)
    if (existing) {
      await query(
        `UPDATE partner_accounts
         SET org_name = ?, contact_email = ?, contact_phone = ?, website_url = ?
         WHERE id = ?`,
        [orgName, contactEmail, contactPhone, websiteUrl, existing.id]
      )
    } else {
      await query(
        `INSERT INTO partner_accounts (user_id, org_name, contact_email, contact_phone, website_url)
         VALUES (?, ?, ?, ?, ?)`,
        [user.id, orgName, contactEmail, contactPhone, websiteUrl]
      )
    }

    const partner = await getPartner(user.id)
    return res.status(200).json({ partner })
  } catch (error) {
    console.error('Partner account error:', error)
    return res.status(500).json({ error: 'Failed to load partner account' })
  }
}

async function getPartner(userId) {
  return queryOne(
    `SELECT id, user_id, org_name, contact_email, contact_phone, website_url,
            stripe_customer_id, status, created_at
     FROM partner_accounts WHERE user_id = ?`,
    [userId]
  )
}

function isValidWebsite(url) {
  if (typeof url !== 'string' || url.length > 500) return false
  if (/<script|javascript:|data:/i.test(url)) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export default withCors(handler)
