/**
 * GET /api/share/user-map/[username]
 *
 * Share-prerender redirect. Returns a tiny HTML document with og:* meta
 * tags pointing at /api/og/user-map/[username]. Crawlers (iMessage,
 * WhatsApp, Slack, Twitter) read the meta tags for link previews;
 * humans get an instant client-side redirect to the SPA route.
 *
 * Privacy: private accounts redirect to /, never confirming existence.
 */

import { queryOne } from '../../lib/db.js'

export default async function handler(req, res) {
  const { username } = req.query
  if (!username || typeof username !== 'string') {
    return res.status(404).end()
  }

  try {
    const target = await queryOne(
      `SELECT u.id, u.username, u.display_name,
              ups.is_private_account
       FROM users u
       LEFT JOIN user_privacy_settings ups ON ups.user_id = u.id
       WHERE u.username = ?`,
      [username]
    )

    const isPrivateAccount = target ? (target.is_private_account === null ? true : !!target.is_private_account) : true

    if (!target || isPrivateAccount) {
      return res.redirect(302, '/')
    }

    const proto = req.headers['x-forwarded-proto'] || 'https'
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const origin = `${proto}://${host}`
    const safeUsername = encodeURIComponent(target.username)
    const ogImage = `${origin}/api/og/user-map/${safeUsername}`
    const pageUrl = `${origin}/user/${safeUsername}/map`
    const displayName = target.display_name || target.username
    const title = `${displayName}'s ROAM map`
    const description = `Places ${displayName} has visited on ROAM`

    const escape = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

    const titleEsc = escape(title)
    const descEsc = escape(description)

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, s-maxage=300')
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${titleEsc}</title>
<meta name="description" content="${descEsc}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${titleEsc}" />
<meta property="og:description" content="${descEsc}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${pageUrl}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${titleEsc}" />
<meta name="twitter:description" content="${descEsc}" />
<meta name="twitter:image" content="${ogImage}" />
<meta http-equiv="refresh" content="0;url=${pageUrl}" />
</head>
<body>
<script>window.location.replace(${JSON.stringify(pageUrl)})</script>
<noscript><a href="${pageUrl}">Open the map</a></noscript>
</body>
</html>`)
  } catch (err) {
    console.error('Share prerender error', err)
    return res.redirect(302, '/')
  }
}
