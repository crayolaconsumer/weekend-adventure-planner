/**
 * Link previews for shared pages. vercel.json rewrites these to here:
 *   /place/:id          → ?kind=place&id=
 *   /plan/share/:code   → ?kind=plan&code=
 *   /user/:username     → ?kind=user&username=
 *
 * Returns the normal app HTML (the SPA boots exactly as before) with that
 * page's title, description and image in the meta tags, because WhatsApp,
 * iMessage, Facebook, X and Google read HTML without running JS: before this
 * every shared link previewed as the generic "ROAM — Stop scrolling" card.
 * Any failure serves the page unchanged, so these URLs can never break.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { queryOne } from './lib/db.js'
import { validateShareCode } from './lib/validation.js'
import { applyPageMeta } from '../shared/pageMeta.mjs'
import { lookupPlace } from './lib/placeLookup.js'
import imageResolve from './places/image-resolve.js'
import { callJson } from './lib/invoke.js'

export const config = { runtime: 'nodejs' }

const SITE = 'https://www.go-roam.uk'
const HIT = 'public, s-maxage=86400, stale-while-revalidate=604800'
const MISS = 'public, s-maxage=600'
// Link-preview bots are the only readers of these tags, so they get time for a
// cold lookup (cached for everyone after); people get the app shell fast.
const PREVIEW_BOT = /\bbot\b|bot[/-]|crawl|spider|facebookexternalhit|whatsapp|slack|telegrambot|discord|linkedinbot|skype|embedly|pinterestbot|preview|mastodon|iframely|google-pagerenderer/i
export const isPreviewBot = req => PREVIEW_BOT.test(req.headers['user-agent'] || '')
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise(res => setTimeout(() => res(fallback), ms))])

// Built index.html, bundled via vercel.json "includeFiles" (an HTTP self-fetch
// would fail on password-protected preview deployments)
let template
function readTemplate() {
  template ??= readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8')
  return template
}

// ─── Per-kind meta ───────────────────────────────────────────────

async function placeMeta(id, ip, { bot, proxy, resolver } = {}) {
  // One deadline for both steps: bots get time for a cold lookup, people get the page fast
  const deadline = Date.now() + (bot ? 7000 : 1500)
  const place = await lookupPlace(id, ip, { proxy, timeoutMs: deadline - Date.now() })
  if (!place) return null
  // Only preview bots read og:image, so people don't wait on the photo lookup
  const query = Object.fromEntries(Object.entries({
    ...place.hints, name: place.name, category: place.icon,
    lat: place.lat == null ? undefined : String(place.lat), lng: place.lng == null ? undefined : String(place.lng)
  }).filter(([, v]) => v))
  const photo = bot ? await withTimeout(callJson(resolver ?? imageResolve, query, ip), Math.max(0, deadline - Date.now()), null) : null
  return {
    title: `${place.name} | ROAM`,
    description: `${place.kind || 'A place'}${place.where ? ` in ${place.where}` : ''}. Save it, plan a visit and find more places like it on ROAM.`,
    // The card reads its text from the id server-side: no free text on a ROAM-branded image
    image: photo?.url || `${SITE}/api/og/place?id=${encodeURIComponent(id)}`,
    imageAlt: place.name
  }
}

async function planMeta(code) {
  if (!validateShareCode(code).valid) return null
  const plan = await queryOne(
    `SELECT p.id, p.title, u.username,
       (SELECT COUNT(*) FROM plan_stops s WHERE s.plan_id = p.id) AS stops
     FROM plans p JOIN users u ON p.user_id = u.id
     WHERE p.share_code = ? AND p.is_public = 1 AND u.is_banned = FALSE`,
    [code]
  )
  if (!plan) return null
  const stops = Number(plan.stops) || 0
  return {
    title: `${plan.title} | ROAM`,
    description: `${stops ? `A ${stops}-stop day out` : 'A day out'} planned by @${plan.username} on ROAM. See the route, vote on stops and plan your own.`,
    image: `${SITE}/api/og/plan?code=${encodeURIComponent(code)}`,
    imageAlt: plan.title
  }
}

// Only what a private profile shows anyway: display name and username
async function userMeta(username) {
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(username || '')) return null
  const user = await queryOne('SELECT username, display_name FROM users WHERE username = ? AND is_banned = FALSE', [username])
  if (!user) return null
  const name = user.display_name || user.username
  return {
    path: `/user/${user.username}`,
    title: `${name} (@${user.username}) | ROAM`,
    description: `See the places ${name} has explored on ROAM, the app for finding things to do nearby.`
  }
}

export function createHandler(deps = {}) {
  return async function handler(req, res) {
    const { kind, id, code, username } = req.query || {}
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
    let html
    try {
      html = (deps.readTemplate ?? readTemplate)()
    } catch (err) {
      // Template not bundled: send them to the app instead of a 500 on every shared link
      console.error(`[share-meta] template: ${err.message}`)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Location', '/')
      return res.status(307).end()
    }
    let cache = MISS
    const bot = isPreviewBot(req)
    try {
      const meta = kind === 'place' ? await placeMeta(id, ip, { ...deps, bot })
        : kind === 'plan' ? await planMeta(code)
          : kind === 'user' ? await userMeta(username)
            : null
      if (meta) {
        const path = meta.path || (kind === 'place' ? `/place/${id}` : `/plan/share/${code}`)
        html = applyPageMeta(html, { ...meta, url: `${SITE}${path}` })
        // A person's page has no photo; the CDN must not hand it to preview bots
        cache = kind === 'place' && !bot ? 'private, no-store' : HIT
      }
    } catch (err) {
      // Lookup failed or timed out: don't let the CDN hand this generic page to the
      // next preview bot (only a definite "no such place" is cached)
      cache = 'private, no-store'
      console.warn(`[share-meta] ${kind}: ${err.message}`)
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', cache)
    return res.status(200).send(html)
  }
}

export default createHandler()
