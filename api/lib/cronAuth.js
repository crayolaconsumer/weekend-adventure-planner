/**
 * Cron auth. Vercel sends `Authorization: Bearer <CRON_SECRET>` on scheduled
 * runs. The `x-vercel-cron` header is NOT proof: anyone can send it, so it is
 * ignored. Fails closed when CRON_SECRET is unset.
 */

import { timingSafeEqual } from 'node:crypto'

export function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(String(req.headers?.authorization || ''))
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
