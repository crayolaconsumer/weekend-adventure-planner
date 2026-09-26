/**
 * GET /sitemap.xml (rewritten to /api/sitemap in vercel.json)
 *
 * Public indexable routes plus every /place/:id page users have saved or
 * visited. Only IDs the Place page can actually load are listed: numeric
 * OSM IDs (bare or typed n/w/r) and otm_ OpenTripMap IDs (wiki_ IDs can't be fetched by ID).
 * If the DB is unavailable the static routes are still served.
 */

import { query } from './lib/db.js'
import { TOWNS } from '../shared/towns.mjs'

const SITE = 'https://www.go-roam.uk'
const STATIC_PATHS = [
  '/', '/events', '/pricing', '/partners', '/get-roam', '/support', '/privacy', '/terms', '/town',
  ...TOWNS.map(t => `/town/${t.slug}`)
]
const MAX_PLACES = 5000

export default async function handler(req, res) {
  const urls = STATIC_PATHS.map(path => ({ loc: `${SITE}${path}` }))

  try {
    const places = await query(
      `SELECT place_id, MAX(activity_at) AS lastmod FROM (
         SELECT place_id, saved_at AS activity_at FROM saved_places
         UNION ALL
         SELECT place_id, visited_at FROM visited_places
       ) p
       WHERE place_id REGEXP '^([0-9]+|[nwr][0-9]+|otm_[A-Za-z0-9]+)$'
       GROUP BY place_id
       ORDER BY COUNT(*) DESC, lastmod DESC
       LIMIT ?`,
      [MAX_PLACES]
    )
    for (const p of places) {
      urls.push({
        loc: `${SITE}/place/${encodeURIComponent(p.place_id)}`,
        lastmod: p.lastmod ? new Date(p.lastmod).toISOString().slice(0, 10) : null
      })
    }
  } catch (err) {
    console.error('sitemap: place query failed', err)
  }

  const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n'

  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).send(body)
}
