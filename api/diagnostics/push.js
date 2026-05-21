/**
 * GET/POST /api/diagnostics/push
 *
 * Auth-gated push diagnostics for the requesting user's subscriptions.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'
import { withCors } from '../lib/cors.js'
import {
  formatEndpointPrefix,
  getPushValidationStatus,
  sendDiagnosticPushToUser
} from '../lib/pushNotifications.js'

async function ensureDiagnosticsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS push_diagnostic_tests (
      user_id INT NOT NULL PRIMARY KEY,
      tested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      result_json JSON NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

function toIso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

async function getSubscriptions(userId) {
  const rows = await query(
    `SELECT platform, endpoint, created_at
     FROM push_subscriptions
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  )

  return rows.map(row => ({
    platform: row.platform,
    endpoint_prefix: formatEndpointPrefix(row.endpoint),
    created_at: toIso(row.created_at)
  }))
}

async function getLastTest(userId) {
  const row = await queryOne(
    'SELECT tested_at, result_json FROM push_diagnostic_tests WHERE user_id = ?',
    [userId]
  )
  if (!row) return null

  let result = row.result_json
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result)
    } catch {
      result = null
    }
  }

  return {
    tested_at: toIso(row.tested_at),
    result
  }
}

async function buildResponse(userId, extra = {}) {
  const status = getPushValidationStatus()
  return {
    validation: status.validation,
    validationErrors: status.errors,
    subscriptions: {
      userId,
      platforms: await getSubscriptions(userId)
    },
    lastTest: await getLastTest(userId),
    ...extra
  }
}

async function handler(req, res) {
  const rateLimit = req.method === 'POST' ? RATE_LIMITS.API_WRITE : RATE_LIMITS.API_GENERAL
  const rateLimitError = applyRateLimit(req, res, rateLimit, 'push:diagnostics')
  if (rateLimitError) {
    return res.status(rateLimitError.status).json(rateLimitError)
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    await ensureDiagnosticsTable()

    if (req.method === 'GET') {
      return res.status(200).json(await buildResponse(user.id))
    }

    if (req.body?.test !== true) {
      return res.status(400).json({ error: 'POST body must include { "test": true }' })
    }

    const diagnostic = await sendDiagnosticPushToUser(user.id)
    const result = {
      sent_at: new Date().toISOString(),
      deliveries: diagnostic.results
    }

    await query(
      `INSERT INTO push_diagnostic_tests (user_id, tested_at, result_json)
       VALUES (?, NOW(), ?)
       ON DUPLICATE KEY UPDATE tested_at = NOW(), result_json = VALUES(result_json)`,
      [user.id, JSON.stringify(result)]
    )

    return res.status(200).json(await buildResponse(user.id, { test: result }))
  } catch (err) {
    console.error('Push diagnostics error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export default withCors(handler)
