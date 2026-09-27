import process from 'node:process'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// QA: the white category pill ("Food & Drink") used var(--roam-forest), which
// dark mode turns light green: 2.8:1 on white. Must reach WCAG AA 4.5:1 in
// both themes.
const read = f => readFileSync(resolve(process.cwd(), f), 'utf8')
const index = read('src/index.css')
const darkStart = index.indexOf('--roam-forest: #6ea58a')
const tokens = {
  light: Object.fromEntries([...index.slice(0, darkStart).matchAll(/(--roam-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]])),
  dark: Object.fromEntries([...index.slice(darkStart - 400).matchAll(/(--roam-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]])),
}

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe.each([
  ['src/components/PlaceDetail.css', '.place-detail-category {'],
  ['src/components/EventDetail.css', '.event-detail-source {'],
])('%s white pill', (file, selector) => {
  const css = read(file)
  const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
  const color = rule.match(/\n\s*color:\s*([^;]+);/)[1].trim()

  it.each(['light', 'dark'])('text reaches 4.5:1 on white in %s mode', theme => {
    expect(rule).toMatch(/background: rgba\(255, 255, 255, 0\.95\)/)
    const hex = color.startsWith('var(') ? tokens[theme][color.slice(4, -1)] : color
    expect(contrast(hex, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
