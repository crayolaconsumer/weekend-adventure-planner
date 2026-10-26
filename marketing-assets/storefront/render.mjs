// Renders the store screenshot set from frames.json through frame.html at each store size.
// Usage: node render.mjs --variant C --frames frames-global.json --shots /tmp/storefront/pick \
//          --bgs /tmp/store-listing/gen/batch --out /tmp/storefront/out [--sizes ios69,ios65,play] [--only 1,2,3] [--device iphone]
// Needs playwright-core and an installed Chrome (kept out of the app's dependencies:
// run it from a folder with playwright-core installed, e.g. NODE_PATH=/tmp/storefront/tool/node_modules).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const require = createRequire(join(process.env.NODE_PATH || here, 'x.js'))
const { chromium } = require('playwright-core')

// CSS size x 3 = the exact pixel size each store asks for
const SIZES = {
  ios69: { width: 430, height: 932 },  // 1290x2796, iPhone 6.9"
  ios65: { width: 428, height: 926 },  // 1284x2778, iPhone 6.5"
  play: { width: 360, height: 640 },   // 1080x1920, Play phone 9:16
}
const variant = args.variant || 'A'
const sizes = (args.sizes || 'ios69,ios65,play').split(',')
const only = args.only ? new Set(args.only.split(',').map(Number)) : null
const frames = JSON.parse(readFileSync(resolve(here, args.frames || 'frames.json'), 'utf8'))

// The app's own photo-less card art (src/utils/placeArt.js): contour rings, here as a
// faint forest-green texture on the cream background, one seed per frame
const { contourLayout, W, H } = await import(resolve(here, '../../src/utils/placeArt.js'))
function contourSvg(seed) {
  const { rings } = contourLayout(seed)
  const paths = rings.map(r => `<path d="${r.d}" stroke-width="${r.index ? 1.1 : 0.6}" stroke-opacity="${r.index ? 0.16 : 0.09}"/>`).join('')
  const file = join(args.out, `contours-${seed}.svg`)
  writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#1a3a2f" stroke-linejoin="round">${paths}</g></svg>`)
  return 'file://' + resolve(file)
}

const metrics = []
const browser = await chromium.launch({ channel: 'chrome' })
for (const size of sizes) {
  const page = await browser.newPage({ viewport: SIZES[size], deviceScaleFactor: 3 })
  const outDir = resolve(args.out, variant, size)
  mkdirSync(outDir, { recursive: true })
  // A full render replaces the set: frames dropped from frames.json must not linger
  if (!only) for (const f of readdirSync(outDir)) if (f.endsWith('.png')) unlinkSync(join(outDir, f))
  for (const [i, f] of frames.entries()) {
    const n = i + 1
    if (only && !only.has(n)) continue
    const q = new URLSearchParams({ v: variant, ...Object.fromEntries(Object.entries(f).filter(([k]) => !['bg', 'shot', 'items', 'recap', 'alt', 'where', 'meta', 'claim'].includes(k))) })
    // The App Store set may show an iPhone; the Play set must not show another platform's device
    if (size.startsWith('ios') && args.device === 'iphone') q.set('device', 'iphone')
    q.set('contours', contourSvg(`roam-frame-${n}`))
    if (f.recap) {
      q.set('items', JSON.stringify(f.items))
      q.set('icon', 'file://' + resolve(here, '../../public/icons/icon-512.png'))
    } else {
      // bg is optional: without one the frame is the app's own cream and contours
      const bg = f.bg && resolve(args.bgs, `${f.bg}.png`)
      const shot = resolve(args.shots, `${f.shot}.png`)
      if ((bg && !existsSync(bg)) || !existsSync(shot)) { console.log(`skip ${n}: missing ${bg && !existsSync(bg) ? bg : shot}`); continue }
      if (bg) q.set('bg', 'file://' + bg)
      q.set('shot', 'file://' + shot)
    }
    await page.goto('file://' + join(here, 'frame.html') + '?' + q, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => [...document.images].filter(im => im.getAttribute('src')).every(im => im.complete && im.naturalWidth))
    const file = join(outDir, `${String(n).padStart(2, '0')}_${f.shot || 'recap'}.png`)
    await page.screenshot({ path: file })
    // Rubric numbers, measured from the rendered layout (not eyeballed): caption block
    // height and screen width as shares of the canvas
    const m = await page.evaluate(() => {
      const H = innerHeight, W = innerWidth
      const copy = document.querySelector('.copy').getBoundingClientRect()
      const head = document.querySelector('.head'); const after = getComputedStyle(head, '::after')
      const ruleH = after.content !== 'none' ? parseFloat(after.height) + parseFloat(after.marginTop) : 0
      const top = document.querySelector('.eyebrow').offsetHeight && getComputedStyle(document.querySelector('.eyebrow')).display !== 'none'
        ? document.querySelector('.eyebrow').getBoundingClientRect().top : head.getBoundingClientRect().top
      const sub = document.querySelector('.sub'); const subVisible = sub.textContent && getComputedStyle(sub).display !== 'none'
      const bottom = subVisible ? sub.getBoundingClientRect().bottom : head.getBoundingClientRect().bottom + ruleH
      const phone = document.querySelector('.phone'); const phoneVisible = getComputedStyle(phone).display !== 'none'
      return { captionPct: +((bottom - top) / H * 100).toFixed(1), phoneWidthPct: phoneVisible ? +(phone.getBoundingClientRect().width / W * 100).toFixed(1) : null, lines: Math.round(head.getBoundingClientRect().height / parseFloat(getComputedStyle(head).lineHeight || 1) ) }
    })
    metrics.push({ size, frame: n, file: file.split('/').pop(), ...m })
    console.log(file, JSON.stringify(m))
  }
  await page.close()
}
writeFileSync(resolve(args.out, variant, 'metrics.json'), JSON.stringify(metrics, null, 2))
await browser.close()
