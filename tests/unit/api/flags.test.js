import { describe, it, expect, vi, beforeEach } from 'vitest'

// roam:flags reads `stored`; roam:poiGen reads `genStored`
let stored
let genStored = null
vi.mock('../../../api/lib/kvCache.js', () => ({
  cacheGet: async key => {
    const value = key === 'roam:poiGen' ? genStored : key === 'roam:flags' ? stored : null
    if (value instanceof Error) throw value
    return value
  }
}))
vi.mock('../../../api/lib/db.js', () => ({ getPool: () => { throw new Error('no DB in flag tests') } }))

async function poiGen() {
  vi.resetModules()
  const { getPoiGen } = await import('../../../api/lib/poiQuery.js')
  return getPoiGen()
}

// Fresh module each time: flags are cached in memory for 30 s
async function flags() {
  vi.resetModules()
  const { getFlags } = await import('../../../api/lib/flags.js')
  return getFlags()
}

describe('flags: numeric poiDbPct', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })

  it('defaults to 0 with no flag blob', async () => {
    stored = null
    expect((await flags()).poiDbPct).toBe(0)
  })

  it('takes a number from KV, clamped to 0-100', async () => {
    for (const [value, want] of [[25, 25], [100, 100], [150, 100], [-5, 0], [0, 0]]) {
      stored = { poiDbPct: value }
      expect((await flags()).poiDbPct).toBe(want)
    }
  })

  it('ignores a non-number (fails closed to 0)', async () => {
    for (const value of ['50', true, null, NaN, Infinity, { pct: 50 }]) {
      stored = { poiDbPct: value }
      expect((await flags()).poiDbPct).toBe(0)
    }
  })

  it('fails closed to 0 when KV errors, while boolean flags still fail open', async () => {
    stored = new Error('KV down')
    const f = await flags()
    expect(f.poiDbPct).toBe(0)
    expect(f.overpassProxy).toBe(true)
  })

  it('poiCapPct is numeric too, default 0, fails closed', async () => {
    stored = { poiCapPct: 20 }
    expect((await flags()).poiCapPct).toBe(20)
    stored = { poiCapPct: true }
    expect((await flags()).poiCapPct).toBe(0)
    stored = null
    expect((await flags()).poiCapPct).toBe(0)
  })

  it('poiShadowPct is numeric too, default 0, fails closed', async () => {
    stored = { poiShadowPct: 10 }
    expect((await flags()).poiShadowPct).toBe(10)
    stored = { poiShadowPct: 'all' }
    expect((await flags()).poiShadowPct).toBe(0)
    stored = new Error('KV down')
    expect((await flags()).poiShadowPct).toBe(0)
  })

  it('the generation lives in its own key: a flags-blob write cannot change it, nor it the flags', async () => {
    stored = { poiDbPct: 25, poiGen: 99 } // an old-style or hand-edited blob
    genStored = 7
    expect(await poiGen()).toBe(7)
    const f = await flags()
    expect(f.poiGen).toBeUndefined()
    expect(f.poiDbPct).toBe(25)

    stored = { poiDbPct: 0, overpassProxy: false } // an admin kill-switch write
    expect(await poiGen()).toBe(7)
    genStored = 8 // the loader's INCR
    expect(await flags()).toMatchObject({ poiDbPct: 0, overpassProxy: false })
    expect(await poiGen()).toBe(8)
  })

  it('reads the INCR counter (a number or a numeric string) and soft-fails to the last known', async () => {
    vi.resetModules()
    const { getPoiGen, peekPoiGen } = await import('../../../api/lib/poiQuery.js')
    genStored = null
    expect(await getPoiGen()).toBe(0) // never bumped
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (const [value, want] of [['12', 12], [13, 13], [null, 13], [new Error('KV down'), 13], ['junk', 13], [-4, 13], [14, 14]]) {
        vi.setSystemTime(Date.now() + 31_000) // past the 30 s cache
        expect(peekPoiGen()).toBeNull()
        genStored = value
        expect(await getPoiGen()).toBe(want)
        expect(peekPoiGen()).toBe(want)
      }
    } finally {
      vi.useRealTimers()
      genStored = null
    }
  })

  it('peekFlags: synchronous, only while the cached copy is fresh', async () => {
    vi.resetModules()
    const mod = await import('../../../api/lib/flags.js')
    expect(mod.peekFlags()).toBeNull()
    stored = { poiDbPct: 5 }
    await mod.getFlags()
    expect(mod.peekFlags().poiDbPct).toBe(5)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 31_000)
      expect(mod.peekFlags()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('boolean flags still only take booleans', async () => {
    stored = { overpassProxy: 0, pushNudges: false }
    const f = await flags()
    expect(f.overpassProxy).toBe(true)
    expect(f.pushNudges).toBe(false)
  })
})
