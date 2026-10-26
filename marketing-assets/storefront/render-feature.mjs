// Renders the Play feature graphic (1024x500) from feature.html.
// Usage: NODE_PATH=<dir with playwright-core>/node_modules node render-feature.mjs <bg.png> <out.png> [card-screenshot.png]
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(process.env.NODE_PATH || here, 'x.js'))
const { chromium } = require('playwright-core')
const [bg, out, card] = process.argv.slice(2).map(p => resolve(p))
const b = await chromium.launch({ channel: 'chrome' })
const page = await b.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 })
await page.goto('file://' + join(here, 'feature.html') + '?' + new URLSearchParams({ bg: 'file://' + bg, ...(card ? { card: 'file://' + card } : {}) }), { waitUntil: 'networkidle' })
await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))) })
await page.screenshot({ path: out })
await b.close()
console.log(out)
