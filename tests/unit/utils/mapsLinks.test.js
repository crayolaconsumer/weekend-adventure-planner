import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Every in-app "open directions" goes through src/utils/navigation.js so
// iPhone users reach Apple Maps. Calendar exports keep Google web links
// (calendars are cross-platform).
const ALLOWED = new Set(['src/utils/navigation.js', 'src/components/plan/CalendarExport.jsx'])

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(jsx?|tsx?)$/.test(p) ? [p] : []
  })
}

describe('maps handoff goes through one helper', () => {
  it('no hard-coded Google directions links outside navigation.js', () => {
    const offenders = files('src').filter(p => !ALLOWED.has(p) && readFileSync(p, 'utf8').includes('google.com/maps/dir'))
    expect(offenders).toEqual([])
  })

  it('Wishlist uses the platform helper, not the legacy positional signature', () => {
    const src = readFileSync('src/pages/Wishlist.jsx', 'utf8')
    expect(src).toContain('openMapsDirections({ to: place })')
    expect(src).not.toMatch(/openDirections\(/)
  })
})
