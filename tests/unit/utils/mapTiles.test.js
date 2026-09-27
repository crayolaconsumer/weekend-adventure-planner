import process from 'node:process'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('mapTiles', () => {
  it('adds the CARTO key to every tile URL when configured (regression: tiles stamped "API KEY REQUIRED")', async () => {
    vi.stubEnv('VITE_CARTO_BASEMAPS_KEY', 'abc123')
    const { TILE_LIGHT, TILE_DARK, tileUrlFor } = await import('../../../src/utils/mapTiles')
    expect(TILE_LIGHT).toBe('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=abc123')
    expect(TILE_DARK).toContain('/dark_all/')
    expect(TILE_DARK).toMatch(/\?key=abc123$/)
    expect(tileUrlFor('dark')).toBe(TILE_DARK)
    expect(tileUrlFor('light')).toBe(TILE_LIGHT)
  })

  it('works without a key (no stray "?key=")', async () => {
    vi.stubEnv('VITE_CARTO_BASEMAPS_KEY', '')
    const { TILE_LIGHT } = await import('../../../src/utils/mapTiles')
    expect(TILE_LIGHT).not.toContain('?')
  })
})

// The tile URL's {r} already asks for @2x tiles on dpr > 1. detectRetina on top
// also bumps the zoom and halves the tile size, so a retina phone pulled @2x
// tiles at 128px: 4x the pixels (12 tiles, ~459 KiB on the place page mini map,
// which Lighthouse picked as the 6.6 s LCP).
describe('map tile layers', () => {
  const walk = d => readdirSync(d, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : /\.jsx?$/.test(e.name) ? [join(d, e.name)] : []))
  const tileUsers = walk(resolve(process.cwd(), 'src'))
    .filter(f => /tileUrlFor|TILE_(LIGHT|DARK)/.test(readFileSync(f, 'utf8')) && !f.endsWith('mapTiles.js'))

  it('finds the maps that use the CARTO tiles', () => {
    expect(tileUsers.length).toBeGreaterThanOrEqual(4)
  })

  it.each(tileUsers.map(f => [f.slice(process.cwd().length + 1), f]))('%s leaves retina to {r}, not detectRetina', (_, f) => {
    expect(readFileSync(f, 'utf8')).not.toMatch(/detectRetina/)
  })
})
