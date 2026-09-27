import process from 'node:process'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('desktop location banner', () => {
  it('pushes the fixed top nav below the banner so the nav stays clickable', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\s+/g, ' ')
    const desktop = css.match(/@media \(min-width: 1024px\) \{ \.location-banner \{ height: (\d+)px; \}(.*?)\} \}/)
    expect(desktop).not.toBeNull()
    const h = desktop[1]
    expect(desktop[2]).toContain(`body.has-location-banner .nav-bar { top: ${h}px; }`)
    expect(desktop[2]).toContain(`body.has-location-banner main { padding-top: ${h}px;`)
  })
})
