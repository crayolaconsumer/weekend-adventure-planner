import { describe, it, expect, vi, afterEach } from 'vitest'

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
