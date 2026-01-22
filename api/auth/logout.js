/**
 * POST /api/auth/logout
 *
 * Log out user by clearing auth cookie.
 */

import { createLogoutCookie } from '../lib/auth.js'

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Clear the auth cookie
  res.setHeader('Set-Cookie', createLogoutCookie())

  return res.status(200).json({ success: true })
}
