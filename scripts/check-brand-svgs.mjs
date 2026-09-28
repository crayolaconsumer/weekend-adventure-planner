/** Local SVG regression + visual eval. No server or network needed.
 * Uses installed Playwright, or PLAYWRIGHT_MODULE pointing to its module.
 * Screenshots/measurements go to BRAND_SVG_OUT (default /tmp/roam-brand-svgs).
 * BRAND_SVG_BASELINE optionally overlays saved source to prove regressions.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const out = process.env.BRAND_SVG_OUT || '/tmp/roam-brand-svgs'
const baseline = process.env.BRAND_SVG_BASELINE
fs.mkdirSync(out, { recursive: true })
const sourcePath = file => baseline && fs.existsSync(path.join(baseline, file))
  ? path.join(baseline, file) : path.join(root, file)
const read = file => fs.readFileSync(sourcePath(file), 'utf8')
const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const families = ['CategoryIcon', 'FilterIcon', 'SettingsIcon', 'RatingIcon', 'VibeIcon', 'AchievementBadge', 'EmptyStateIllustration']
const rows = []
let entry = `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';`

for (const family of families) {
  const file = `src/components/icons/${family}.jsx`, ast = parse(file)
  entry += `import ${family} from '${path.join(root, file)}';`
  const registry = ['CategoryIcon', 'AchievementBadge', 'EmptyStateIllustration'].includes(family) ? 'ILLUSTRATIONS' : 'ICONS'
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === registry) {
      for (const property of node.initializer.properties) {
        const key = property.name.text
        const props = family === 'RatingIcon' ? { kind: key.split('.')[0], value: key.split('.')[1] }
          : { [family === 'AchievementBadge' ? 'id' : family === 'EmptyStateIllustration' ? 'variant' : 'name']: key }
        rows.push({ id: `${family}/${key}`, component: family, props,
          sizes: family === 'AchievementBadge' ? [28, 40, 64] : family === 'EmptyStateIllustration' ? [80, 120]
            : family === 'CategoryIcon' ? [14, 18, 24, 32] : [18, 24, 32] })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}
// Render private, stateless icons from their real declarations without mounting
// data-fetching pages or adding public exports solely for a test.
for (const [file, name] of [
  ['src/components/StreakIndicator.jsx', 'FlameIcon'],
  ['src/components/PlaceDetail.jsx', 'WikiIcon'],
  ['src/pages/SharedPlan.jsx', 'ThumbsUpIcon'],
  ['src/pages/SharedPlan.jsx', 'ThumbsDownIcon'],
  ['src/components/Onboarding.jsx', 'CompassMark'],
]) {
  const ast = parse(file)
  let declaration
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!declaration) throw new Error(`Missing ${file}: ${name}`)
  entry += `const ${declaration};`
  rows.push({ id: name, component: name, props: {}, sizes: [null] })
}
entry += `import PremiumBadge from '${root}src/components/PremiumBadge.jsx';`
rows.push({ id: 'PremiumBadge', component: 'PremiumBadge', props: {}, sizes: [12, 14, 24, 56] },
  { id: 'AchievementBadge/locked', component: 'AchievementBadge', props: { id: 'streak_3', locked: true }, sizes: [28, 40, 64] })
entry += `const rows=[${rows.map(r => `{...${JSON.stringify(r)},Component:${r.component}}`).join(',')}];
export const html=renderToStaticMarkup(<main>{rows.map(({id,Component,props,sizes})=><section data-name={id} key={id}>
<h2>{id}</h2><div className="samples">{sizes.map(size=><div key={size||0}><Component {...props} {...(size?{size}:{})}/><small>{size||'native'} px</small></div>)}</div>
<div className="large"><Component {...props} size={96}/></div></section>)}</main>);`
await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root }, bundle: true, platform: 'node',
  format: 'cjs', outfile: `${out}/components.cjs`, jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: baseline ? [{ name: 'saved-source', setup(b) {
    b.onLoad({ filter: /\/src\/.*\.jsx$/ }, args => {
      const saved = path.join(baseline, path.relative(root, args.path))
      if (fs.existsSync(saved)) return { contents: fs.readFileSync(saved, 'utf8'), loader: 'jsx', resolveDir: path.dirname(args.path) }
    })
  } }] : [] })
const { html } = require(`${out}/components.cjs`)
const pageHtml = `<!doctype html><meta charset="utf-8"><style>${read('src/index.css')}\n${read('src/pages/Discover.css')}
main{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px}section{background:var(--color-surface-elevated);color:var(--roam-forest);padding:12px;border:1px solid var(--color-border)}
h2{font:12px system-ui}.samples{display:flex;align-items:center;gap:12px;min-height:135px}.samples>div{display:flex;flex-direction:column;align-items:center}small{font:10px system-ui;margin-top:8px}
.large{width:96px;height:96px;margin:16px auto;outline:1px dashed #9b8370;background:linear-gradient(#a9808055,#a9808055) 50% 0/1px 100% no-repeat,linear-gradient(#a9808055,#a9808055) 0 50%/100% 1px no-repeat}
.large svg,.large>span{width:96px!important;height:96px!important}.large svg{display:block}</style><h1 class="discover-wordmark">ROAM</h1>${html}`
fs.writeFileSync(`${out}/gallery.html`, pageHtml)
const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  await page.route(/^https?:/, route => route.abort())
  await page.setContent(pageHtml)
  const { measurements, checks } = await page.evaluate(async () => {
    const results = []
    for (const cell of document.querySelectorAll('section')) {
      const svg = cell.querySelector('.large svg'), vb = svg.viewBox.baseVal
      const measure = el => {
        const b = el.getBBox(), m = svg.getCTM().inverse().multiply(el.getCTM())
        const corners = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m))
        return { dx: ((corners[0].x + corners[1].x) / 2 - vb.x - vb.width / 2) * 24 / vb.width,
          dy: ((corners[0].y + corners[1].y) / 2 - vb.y - vb.height / 2) * 24 / vb.height }
      }
      const id = cell.dataset.name
      const foreground = /^(CategoryIcon|AchievementBadge)\//.test(id) ? measure(svg.children[3]) : measure(svg)
      // Rasterise with extra space around the viewport. This includes actual
      // strokes, transforms and caps, unlike padding the whole SVG's bbox.
      const clone = svg.cloneNode(true), originals = [svg, ...svg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')]
      originals.forEach((el, i) => {
        const style = getComputedStyle(el)
        copies[i].removeAttribute('style')
        for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity', 'font-family', 'font-size']) copies[i].style.setProperty(k, style.getPropertyValue(k))
      })
      clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height)
      clone.setAttribute('x', vb.x); clone.setAttribute('y', vb.y); clone.style.overflow = 'visible'
      const pad = 4, scale = 8
      const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${(vb.width + pad * 2) * scale}" height="${(vb.height + pad * 2) * scale}" viewBox="${vb.x - pad} ${vb.y - pad} ${vb.width + pad * 2} ${vb.height + pad * 2}">${new XMLSerializer().serializeToString(clone)}</svg>`
      const image = new Image(), url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url })
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); URL.revokeObjectURL(url)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let outsidePixels = 0
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] >= 128 &&
          (x < pad * scale || y < pad * scale || x >= (pad + vb.width) * scale || y >= (pad + vb.height) * scale)) outsidePixels++
      }
      results.push({ id, foreground, outsidePixels })
    }
    const heart = document.querySelector('[data-name="FilterIcon/locals-picks"] .large svg').children[1]
    const start = heart.getPointAtLength(0), end = heart.getPointAtLength(heart.getTotalLength())
    const map = document.querySelector('[data-name="SettingsIcon/map"] .large svg g')
    return { measurements: results, checks: [
      { id: 'locals-heart-closed', pass: Math.hypot(start.x - end.x, start.y - end.y) < 0.01 },
      { id: 'map-folds-within-outline', pass: [...map.children].slice(1).every(fold =>
        [0, fold.getTotalLength()].every(length => map.children[0].isPointInFill(fold.getPointAtLength(length)))) },
      { id: 'wordmark-no-floating-overlay', pass: getComputedStyle(document.querySelector('.discover-wordmark'), '::after').content === 'none' },
    ] }
  })
  const centred = ['FlameIcon', 'CategoryIcon/nature', 'AchievementBadge/streak_3', 'AchievementBadge/first_adventure',
    'AchievementBadge/curator', 'AchievementBadge/contributor_50', 'SettingsIcon/bell']
  const failures = [...measurements.filter(m => m.outsidePixels || centred.includes(m.id) && Math.max(Math.abs(m.foreground.dx), Math.abs(m.foreground.dy)) > 0.5),
    ...checks.filter(c => !c.pass)]
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await page.screenshot({ path: `${out}/${theme}.png`, fullPage: true })
  }
  // Focused sheets are readable without scaling a full inventory to one screen.
  await page.evaluate(ids => { for (const e of document.querySelectorAll('section')) if (!ids.includes(e.dataset.name)) e.remove() },
    [...centred, 'WikiIcon', 'ThumbsUpIcon', 'ThumbsDownIcon', 'FilterIcon/locals-picks', 'SettingsIcon/map'])
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await page.screenshot({ path: `${out}/focus-${theme}.png`, fullPage: true })
  }
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ variants: measurements.length, failures, checks, measurements }, null, 2))
  console.log(JSON.stringify({ variants: measurements.length, failures, artifacts: out }, null, 2))
  if (failures.length) process.exitCode = 1
} finally {
  await browser.close()
}
