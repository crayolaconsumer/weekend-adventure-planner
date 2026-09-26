/**
 * Link-preview images (1200x630) in ROAM's look (docs/BRAND.md): cream page,
 * Newsreader title in forest, CategoryIcon medallion, compass + wordmark.
 * Rendered with @vercel/og on the Node runtime (Edge can no longer compile
 * its WebAssembly: every card came back as an empty PNG). Plain .js with
 * createElement, not JSX: Vercel only compiles .tsx function entry files, so
 * a shared .tsx module isn't there at runtime (ERR_MODULE_NOT_FOUND).
 */
import { ImageResponse } from '@vercel/og'
import { createElement as h } from 'react'
import { CATEGORY_SVGS } from './brandSvgs.js'

const FOREST = '#1a3a2f'
const CREAM = '#faf8f5'
const INK_LIGHT = '#4a443d'
const SAGE_TINT = '#e3ebe4'

// Compass mark (public/icons/icon.svg)
const COMPASS = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="256" fill="#1a3a2f"/><g transform="translate(256,256)"><circle r="180" fill="none" stroke="#d4a855" stroke-width="8"/><polygon points="0,-160 20,-40 -20,-40" fill="#d4a855"/><polygon points="0,160 20,40 -20,40" fill="#fdfcf8"/><polygon points="160,0 40,20 40,-20" fill="#fdfcf8"/><polygon points="-160,0 -40,20 -40,-20" fill="#fdfcf8"/><circle r="30" fill="#d4a855"/><circle r="15" fill="#1a3a2f"/></g></svg>')
const medallion = name => CATEGORY_SVGS[name] && 'data:image/svg+xml;utf8,' + encodeURIComponent(CATEGORY_SVGS[name])

// Brand fonts from Google Fonts as TTF (what the renderer accepts), fetched once per instance
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Newsreader:wght@400&family=Outfit:wght@400;600'
let fontsPromise
export function brandFonts(fetchImpl = fetch) {
  fontsPromise ??= (async () => {
    // An old User-Agent makes Google Fonts answer with TTF instead of WOFF2
    const css = await (await fetchImpl(FONT_CSS, { headers: { 'User-Agent': 'Mozilla/4.0' }, signal: AbortSignal.timeout(4000) })).text()
    const faces = [...css.matchAll(/font-family: '([^']+)';[\s\S]*?font-weight: (\d+);[\s\S]*?url\((https:[^)]+\.ttf)\)/g)]
    return Promise.all(faces.map(async ([, name, weight, url]) => ({
      name, weight: Number(weight), style: 'normal',
      data: await (await fetchImpl(url, { signal: AbortSignal.timeout(4000) })).arrayBuffer()
    })))
  })().catch(() => { fontsPromise = null; return [] }) // default font beats no image
  return fontsPromise
}

/** The shared card: medallion or compass, title, subtitle, optional list. */
export function Card({ title, subtitle, icon, list = [] }) {
  const row = (style, ...children) => h('div', { style: { display: 'flex', ...style } }, ...children)
  return row({ width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'space-between', background: CREAM, padding: '64px 72px', fontFamily: 'Outfit' },
    row({ alignItems: 'center', gap: 40 },
      h('img', { src: medallion(icon) || COMPASS, width: 148, height: 148 }),
      row({ flexDirection: 'column', flex: 1 },
        row({ fontFamily: 'Newsreader', fontWeight: 400, letterSpacing: '-0.04em', fontSize: title.length > 28 ? 64 : 80, lineHeight: 1.05, color: FOREST }, title),
        subtitle ? row({ fontSize: 34, color: INK_LIGHT, marginTop: 16 }, subtitle) : null
      )
    ),
    list.length === 0
      ? row({ fontFamily: 'Newsreader', fontSize: 46, color: FOREST, opacity: 0.8 }, 'Stop scrolling. Start roaming.')
      : row({ flexDirection: 'column', gap: 12 },
        ...list.slice(0, 3).map((item, i) => row({ alignItems: 'center', gap: 16, fontSize: 30, color: INK_LIGHT },
          row({ alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 22, background: SAGE_TINT, color: FOREST, fontWeight: 600 }, String(i + 1)),
          item
        ))
      ),
    row({ alignItems: 'center', justifyContent: 'space-between' },
      row({ alignItems: 'center', gap: 16 },
        h('img', { src: COMPASS, width: 56, height: 56 }),
        row({ fontFamily: 'Newsreader', fontSize: 44, color: FOREST, letterSpacing: '-0.04em' }, 'ROAM')
      ),
      row({ fontSize: 28, color: INK_LIGHT }, 'go-roam.uk')
    )
  )
}

/** Render a card and send it as a PNG on a Node (req, res). */
export async function sendCard(res, props, { sMaxAge = 86400 } = {}) {
  const fonts = await brandFonts()
  // An empty list would replace the renderer's built-in font with nothing
  const img = new ImageResponse(Card(props), { width: 1200, height: 630, ...(fonts.length && { fonts }) })
  return forwardImageResponse(img, res, sMaxAge)
}

/** Pipe an ImageResponse (a Web Response) into Node's res. */
export async function forwardImageResponse(imageResponse, res, sMaxAge) {
  const buffer = Buffer.from(await imageResponse.arrayBuffer())
  // CDN-cached for everyone: drop the per-visitor rate-limit headers
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) res.removeHeader?.(h)
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=86400`)
  return res.status(200).send(buffer)
}
