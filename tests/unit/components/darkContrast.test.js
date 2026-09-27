import process from 'node:process'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Lighthouse color-contrast failures on home, events and place: forest text on
// the elevated surface in dark mode (4.34:1), muted ink (3.2:1) and the
// section titles at 0.7 opacity (2.9:1). Each fixed rule must reach WCAG AA
// 4.5:1 on the elevated surface in both themes, using brand tokens only.
const read = f => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const index = read('src/index.css')
const darkAt = index.indexOf('[data-theme="dark"] {')
const hexes = src => Object.fromEntries([...src.matchAll(/(--roam-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]))
const light = hexes(index.slice(0, darkAt))
const tokens = { light, dark: { ...light, ...hexes(index.slice(darkAt, index.indexOf('}', darkAt))) } }
const alias = { '--color-text-secondary': '--roam-ink-light', '--color-text-muted': '--roam-ink-muted' }
const surface = { light: '#ffffff', dark: tokens.dark['--roam-parchment'] }

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// First (base) `color:` declared by a rule whose selector list contains `selector`.
function colorOf(css, selector) {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].split(',').map(s => s.trim())
    const color = m[2].match(/(?:^|;|\s)color:\s*([^;]+);/)
    if (sels.includes(selector) && color) return { value: color[1].trim(), opacity: m[2].match(/opacity:\s*([\d.]+)/)?.[1] }
  }
  return undefined
}
const resolveHex = (value, theme) => {
  const name = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  expect(name, `${value} must be a brand token`).toBeTruthy()
  return tokens[theme][alias[name] || name]
}

const cases = [
  ['src/index.css', '.nav-item', '[data-theme="dark"] .nav-item'],
  ['src/index.css', '.nav-item.active', '[data-theme="dark"] .nav-item.active'],
  ['src/index.css', '.btn-secondary', '[data-theme="dark"] .btn-secondary'],
  ['src/pages/Events.css', '.events-time-chip', '[data-theme="dark"] .events-time-chip:not(.active)'],
  ['src/pages/Events.css', '.events-filters-toggle', '[data-theme="dark"] .events-filters-toggle:not(.active)'],
  ['src/pages/Events.css', '.events-view-segment.active', '[data-theme="dark"] .events-view-segment.active'],
  ['src/pages/Events.css', '.events-alt-link', '[data-theme="dark"] .events-alt-link'],
  ['src/components/PlaceDetail.css', '.place-detail-section-title', '[data-theme="dark"] .place-detail-section-title'],
  ['src/components/ContributionDisplay.css', '.contributions-empty p', '[data-theme="dark"] .contributions-empty p'],
  ['src/pages/Place.css', '.place-page-error p', '[data-theme="dark"] .place-page-error p'],
  ['src/pages/TownPage.css', '.town-near span span', '[data-theme="dark"] .town-near span span'],
]

describe.each(cases)('%s %s', (file, lightSel, darkSel) => {
  const css = read(file)
  it.each(['light', 'dark'])('reaches 4.5:1 on the elevated surface in %s mode', theme => {
    const rule = (theme === 'dark' && colorOf(css, darkSel)) || colorOf(css, lightSel)
    expect(rule).toBeTruthy()
    const hex = resolveHex(rule.value, theme)
    const ratio = contrast(hex, surface[theme])
    // Opacity blends text toward the surface; only light mode keeps it here.
    const alpha = Number(rule.opacity ?? 1)
    const effective = alpha < 1 ? 1 + (ratio - 1) * alpha : ratio
    expect(effective).toBeGreaterThanOrEqual(4.5)
  })
})
