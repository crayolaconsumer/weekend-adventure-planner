/**
 * POST /api/auth/apple/callback
 *
 * Receives the redirect from Sign in with Apple's web flow. With
 * `usePopup: true` (how we initialise the JS SDK in AuthModal), the
 * popup window intercepts the form-POST result itself — the real
 * auth dance happens client-side via `window.AppleID.auth.signIn()`,
 * which then forwards the identityToken to our /api/auth endpoint
 * with action='apple'. This file's only job is to EXIST: Apple
 * validates that the redirect URI declared in the Services ID's
 * "Return URLs" configuration actually resolves before it'll start
 * an auth session against that URL. A 200 with empty body is enough.
 *
 * If we ever switch to redirect-mode (no popup), this is where the
 * server would receive { code, id_token, state, user? } as a
 * POST body and exchange / decode it. Not used today.
 */

export default function handler(req, res) {
  // Apple POSTs the form data here when popup intercepts; sometimes
  // it also issues a GET to verify the URL is live. Accept both.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Don't expose any user data — the popup has already harvested it.
  // 200 + empty body is all Apple needs.
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send('')
}
