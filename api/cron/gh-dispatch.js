/**
 * Cron: start GitHub Actions workflows on schedule
 *
 * GitHub has never fired a `schedule:` trigger for this repo, so Vercel's cron
 * starts them instead through the workflow_dispatch API:
 *   ?workflow=synthetic  every 15 min  (outage monitor; a failed run emails James)
 *   ?workflow=poi-build  02:15 UTC     (nightly place database build + load)
 * GITHUB_DISPATCH_TOKEN: fine-grained PAT for this repo only, Actions read/write.
 * If a dispatch fails, the monitor itself has stopped: that emails the
 * operator, at most once per 6 h.
 *
 * Auth: the Bearer CRON_SECRET Vercel attaches to scheduled runs (lib/cronAuth.js).
 */

export const config = { runtime: 'nodejs' }

import { isAuthorizedCron } from '../lib/cronAuth.js'
import { sendEmail } from '../lib/email.js'
import { cacheGet, cacheSet } from '../lib/kvCache.js'

const REPO = 'crayolaconsumer/weekend-adventure-planner'
const WORKFLOWS = { synthetic: 'synthetic.yml', 'poi-build': 'poi-build.yml' }
const ALERT_EMAIL = process.env.MODERATION_ALERT_EMAIL || 'fittonj@gmail.com'
const ALERT_THROTTLE_SECONDS = 6 * 60 * 60
const lastAlertAt = {}
const RETRY_DELAY_MS = 2000

export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const name = String(req.query?.workflow || '')
  const file = Object.hasOwn(WORKFLOWS, name) ? WORKFLOWS[name] : null
  if (!file) return res.status(400).json({ error: 'Unknown workflow' })

  const token = process.env.GITHUB_DISPATCH_TOKEN
  let error = token ? null : 'GITHUB_DISPATCH_TOKEN not set'
  // One retry on a timeout or a 5xx: a single slow GitHub answer (4 Nov, 11:00) is not an outage.
  // A retry after a slow-but-delivered call can start the workflow twice; both have a concurrency group.
  for (let attempt = 0; token && attempt < 2; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    let retryable = false
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'ROAM-cron (+https://www.go-roam.uk)',
        },
        body: JSON.stringify({ ref: 'main' }),
        signal: AbortSignal.timeout(10_000),
      })
      error = r.status === 204 ? null : `GitHub answered ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`
      retryable = r.status >= 500
    } catch (err) {
      error = err.message
      retryable = !/invalid header value/i.test(err.message) // a bad token won't fix itself
    }
    if (!error || !retryable) break
  }

  if (!error) return res.status(200).json({ dispatched: name })

  // fetch echoes an invalid header value (a token pasted with a newline) in its error
  if (token) error = error.replaceAll(token, '[token]')
  console.error(`[gh-dispatch] ${name}: ${error}`)
  const throttleKey = `alert:gh-dispatch:${name}`
  // KV down (cacheGet null) must not mean an email every 15 min: this instance remembers too
  if (!(await cacheGet(throttleKey)) && Date.now() - (lastAlertAt[name] || 0) > ALERT_THROTTLE_SECONDS * 1000) {
    lastAlertAt[name] = Date.now()
    await cacheSet(throttleKey, 1, ALERT_THROTTLE_SECONDS)
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `ROAM: could not start the ${name} workflow`,
      text: `Vercel's cron could not start GitHub workflow ${file}.\n\n${error}\n\nIf the token expired or lost access, make a new fine-grained token (this repo only, Actions: read and write) and replace GITHUB_DISPATCH_TOKEN in Vercel.`,
    })
  }
  return res.status(502).json({ error: 'dispatch failed' })
}
