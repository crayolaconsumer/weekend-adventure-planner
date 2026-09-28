import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

  describe('KV outages and kill-switch latency', () => {
    const HUNG = { then() {} } // cacheGet resolves to a thenable that never settles
    let getFlags, peekFlags, reads, t0
    beforeEach(async () => {
      vi.useFakeTimers()
      vi.resetModules()
      ;({ getFlags, peekFlags } = await import('../../../api/lib/flags.js'))
      reads = 0
      t0 = Date.now()
    })
    afterEach(() => vi.useRealTimers())
    // Counts KV reads; `value` may be an object, null, an Error, HUNG, or a { after, value } slow read
    const kv = value => {
      stored = { then(resolve, reject) {
        reads++
        if (value === HUNG) return
        if (value instanceof Error) return reject(value)
        if (value && value.after) return setTimeout(resolve, value.after, value.value)
        resolve(value)
      } }
    }

    for (const [name, outage] of [['returns null', null], ['returns garbage', 'garbage'], ['returns {}', {}], ['returns an array', [1]], ['throws', new Error('quota exceeded')], ['hangs', HUNG]]) {
      it(`KV ${name} for 10 minutes: last-known-good everywhere, peekFlags never null, one read per window`, async () => {
        kv({ poiDbPct: 100, poiCapPct: 30, pushNudges: false })
        await getFlags()
        // Idle past the stale window first: the outage begins on a quiet instance
        await vi.advanceTimersByTimeAsync(90_000)
        kv(outage)
        reads = 0
        for (let t = 0; t < 600_000; t += 5_000) {
          const pending = getFlags()
          await vi.advanceTimersByTimeAsync(5_000)
          const f = await pending
          expect(f.poiDbPct).toBe(100)
          expect(f.poiCapPct).toBe(30)
          expect(f.pushNudges).toBe(false)
          expect(peekFlags()?.poiDbPct).toBe(100)
        }
        expect(reads).toBeLessThanOrEqual(600_000 / 30_000 + 1)
      })
    }

    it('sparse traffic (one request per 70 s) through a hung outage: peekFlags is last-known-good every time', async () => {
      kv({ poiDbPct: 100 })
      await getFlags()
      kv(HUNG)
      reads = 0
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(70_000)
        expect(peekFlags()?.poiDbPct).toBe(100)
      }
      expect(reads).toBeLessThanOrEqual(10)
    })

    it('a read landing late after failed reads does not make last-known-good look expired', async () => {
      kv({ poiDbPct: 100 })
      await getFlags()
      await vi.advanceTimersByTimeAsync(31_000)
      kv({ after: 75_000, value: { poiDbPct: 100 } }) // read A (starts at 31 s): lands at 106 s
      peekFlags()
      await vi.advanceTimersByTimeAsync(0) // read A calls cacheGet on the next microtask
      kv(HUNG) // every later read hangs; peeks keep restarting the window
      for (let t = 0; t < 76_000; t += 1000) {
        await vi.advanceTimersByTimeAsync(1000)
        expect(peekFlags()?.poiDbPct).toBe(100)
      }
      // A has landed; the window was last restarted well under 30 s ago, so no wait
      expect(await Promise.race([getFlags(), new Promise(r => setTimeout(r, 50, 'waited'))])).not.toBe('waited')
    })

    it('thaw after a freeze mid-outage: the first request still gets last-known-good from peekFlags', async () => {
      kv({ poiDbPct: 100 })
      await getFlags()
      await vi.advanceTimersByTimeAsync(40_000)
      kv(HUNG)
      expect(peekFlags().poiDbPct).toBe(100) // starts read A, then the instance freezes
      vi.setSystemTime(Date.now() + 40_000) // thaw: wall clock jumped, timers did not run
      expect(peekFlags().poiDbPct).toBe(100)
    })

    it('a 50 req/s burst during a fast-failing outage makes one KV read per window, not per request', async () => {
      kv({ poiDbPct: 100 })
      await getFlags()
      kv(null)
      reads = 0
      for (let i = 0; i < 3000; i++) { // 60 s at 50 req/s
        expect((await getFlags()).poiDbPct).toBe(100)
        await vi.advanceTimersByTimeAsync(20)
      }
      expect(reads).toBeLessThanOrEqual(3)
    })

    it('busy instance, KV healthy: a kill switch lands within 60 s', async () => {
      kv({ pushNudges: true })
      await getFlags()
      kv({ pushNudges: false })
      let landedAt = null
      for (let t = 0; t <= 90_000 && landedAt === null; t += 1000) {
        if ((await getFlags()).pushNudges === false) landedAt = t
        await vi.advanceTimersByTimeAsync(1000)
      }
      expect(landedAt).not.toBeNull()
      expect(landedAt).toBeLessThanOrEqual(60_000)
    })

    it('idle instance (15-min cron), KV healthy: the kill switch lands on the very next call', async () => {
      kv({ pushNudges: true })
      await getFlags()
      kv({ pushNudges: false })
      await vi.advanceTimersByTimeAsync(15 * 60_000)
      expect((await getFlags()).pushNudges).toBe(false)
    })

    it('cold instance, slow but healthy KV (3 s): waits for the real value, not DEFAULTS', async () => {
      kv({ after: 3000, value: { pushNudges: false, poiDbPct: 100 } })
      const pending = getFlags()
      await vi.advanceTimersByTimeAsync(3000)
      const f = await pending
      expect(f.pushNudges).toBe(false)
      expect(f.poiDbPct).toBe(100)
    })

    it('cold instance, KV slower than the cold timeout: DEFAULTS now, the late value is applied when it lands', async () => {
      kv({ after: 10_000, value: { poiDbPct: 100 } })
      const pending = getFlags()
      await vi.advanceTimersByTimeAsync(8000)
      expect((await pending).poiDbPct).toBe(0)
      await vi.advanceTimersByTimeAsync(2000)
      expect(peekFlags().poiDbPct).toBe(100)
    })

    it('cold instance, KV down: DEFAULTS, and one read per window', async () => {
      kv(new Error('down'))
      for (let i = 0; i < 100; i++) {
        expect((await getFlags()).poiDbPct).toBe(0)
        await vi.advanceTimersByTimeAsync(300)
      }
      expect(reads).toBeLessThanOrEqual(2)
    })

    it('a read abandoned by a function freeze is replaced, so a kill switch set meanwhile still lands', async () => {
      kv({ promotedEvents: true })
      await getFlags()
      await vi.advanceTimersByTimeAsync(40_000)
      kv(HUNG) // a hot-path peek starts a background read, then the instance freezes
      expect(peekFlags().promotedEvents).toBe(true)
      await Promise.resolve(); await Promise.resolve() // let read A reach cacheGet (hung) before the freeze
      vi.setSystemTime(Date.now() + 10 * 60_000) // thaw 10 min later: wall clock jumped, timers did not run
      kv({ promotedEvents: false })
      expect((await getFlags()).promotedEvents).toBe(false)
    })

    it('thaw where the overdue timeout timer runs first: a kill switch set while frozen still lands on the next call', async () => {
      kv({ promotedEvents: true })
      await getFlags()
      await vi.advanceTimersByTimeAsync(40_000)
      kv(HUNG)
      peekFlags() // a hot-path peek starts a background read; the instance freezes
      await Promise.resolve(); await Promise.resolve() // let read A reach cacheGet (hung) before the freeze
      vi.setSystemTime(Date.now() + 10 * 60_000) // thaw
      kv({ promotedEvents: false })
      await vi.runOnlyPendingTimersAsync() // the handler awaited I/O: timers ran before getFlags
      expect((await getFlags()).promotedEvents).toBe(false)
    })

    it('peekFlags alone keeps the flags fresh (image-resolve only ever peeks)', async () => {
      kv({ poiDbPct: 10 })
      await getFlags()
      kv({ poiDbPct: 90 })
      await vi.advanceTimersByTimeAsync(31_000)
      expect(peekFlags().poiDbPct).toBe(10) // stale copy, refresh started
      await vi.advanceTimersByTimeAsync(0)
      expect(peekFlags().poiDbPct).toBe(90)
    })

    it('an older read landing after a newer one cannot revert its flags', async () => {
      kv({ promotedEvents: true })
      await getFlags()
      await vi.advanceTimersByTimeAsync(31_000)
      kv({ after: 60_000, value: { promotedEvents: true } }) // R1: old value, lands late
      peekFlags()
      await vi.advanceTimersByTimeAsync(0)
      kv({ promotedEvents: false }) // R2 (after R1 times out) carries the kill switch
      await vi.advanceTimersByTimeAsync(35_000)
      await getFlags() // stale copy served, R2 started
      await vi.advanceTimersByTimeAsync(0)
      expect((await getFlags()).promotedEvents).toBe(false)
      await vi.advanceTimersByTimeAsync(30_000) // R1 lands
      expect(peekFlags().promotedEvents).toBe(false)
    })

    it('a request every 45 s, frozen in between, KV healthy: a kill switch lands within ~60 s', async () => {
      kv({ pushNudges: true })
      await getFlags()
      const seen = []
      for (let t = 45_000; t <= 180_000; t += 45_000) {
        vi.setSystemTime(t0 + t) // thaw: wall clock jumped, timers did not run
        if (t === 45_000) kv({ pushNudges: true })
        await vi.runOnlyPendingTimersAsync() // the overdue timeout fires first
        seen.push([t, (await getFlags()).pushNudges])
        await vi.advanceTimersByTimeAsync(0)
        if (t === 45_000) kv({ pushNudges: false }) // switch set just after this request
      }
      const landed = seen.find(([, v]) => v === false)?.[0]
      expect(landed).toBe(90_000) // the very next call
    })

    it('a hung outage under a 50 req/s burst of getFlags and peekFlags: one read at a time', async () => {
      kv({ poiDbPct: 100 })
      await getFlags()
      kv(HUNG)
      reads = 0
      for (let t = 0; t < 120_000; t += 20) {
        peekFlags()
        getFlags()
        await vi.advanceTimersByTimeAsync(20)
      }
      expect(reads).toBeLessThanOrEqual(5)
      expect(peekFlags().poiDbPct).toBe(100)
    })

    it('a fast read leaves no timer behind', async () => {
      kv({ poiDbPct: 5 })
      await getFlags()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('cold instance: concurrent first calls share one KV read', async () => {
      kv({ poiDbPct: 40 })
      const all = await Promise.all(Array.from({ length: 10 }, () => getFlags()))
      expect(all.every(f => f.poiDbPct === 40)).toBe(true)
      expect(reads).toBe(1)
    })
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

  it('poiGen: a hung KV never makes peekPoiGen null or getPoiGen wait more than 2 s; recovery lands', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const { getPoiGen, peekPoiGen } = await import('../../../api/lib/poiQuery.js')
      genStored = 7
      expect(await getPoiGen()).toBe(7)
      genStored = { then() {} } // KV hangs
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(31_000)
        expect(peekPoiGen()).toBe(7)
        const pending = getPoiGen()
        await vi.advanceTimersByTimeAsync(2000)
        expect(await pending).toBe(7)
      }
      genStored = 8 // KV back, the loader bumped
      await vi.advanceTimersByTimeAsync(31_000)
      peekPoiGen()
      await vi.advanceTimersByTimeAsync(0)
      expect(peekPoiGen()).toBe(8)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      genStored = null
    }
  })

  it('poiGen: thaw where the overdue timeout fires first: a bump made while frozen lands after one refresh', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const { getPoiGen, peekPoiGen } = await import('../../../api/lib/poiQuery.js')
      genStored = 7
      await getPoiGen()
      await vi.advanceTimersByTimeAsync(31_000)
      genStored = { then() {} }
      peekPoiGen() // starts a read that hangs; the instance freezes
      await Promise.resolve(); await Promise.resolve()
      vi.setSystemTime(Date.now() + 10 * 60_000) // thaw
      genStored = 8 // bumped while frozen
      await vi.runOnlyPendingTimersAsync() // the overdue timeout fires first
      expect(peekPoiGen()).toBe(7) // last known, and starts a refresh (the window was not restarted by the late timer)
      await vi.advanceTimersByTimeAsync(0)
      expect(peekPoiGen()).toBe(8)
    } finally {
      vi.useRealTimers()
      genStored = null
    }
  })

  it('poiGen: a hung KV under a 50 req/s burst of peekPoiGen: one read at a time', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const { getPoiGen, peekPoiGen } = await import('../../../api/lib/poiQuery.js')
      expect(peekPoiGen()).toBeNull() // cold: callers wait briefly on getPoiGen
      genStored = 7
      await getPoiGen()
      let reads = 0
      genStored = { then() { reads++ } }
      for (let t = 0; t < 120_000; t += 20) {
        expect(peekPoiGen()).toBe(7)
        await vi.advanceTimersByTimeAsync(20)
      }
      expect(reads).toBeLessThanOrEqual(5)
    } finally {
      vi.useRealTimers()
      genStored = null
    }
  })

  it('poiGen: an older read landing after a newer one never lowers the generation', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const { getPoiGen, peekPoiGen } = await import('../../../api/lib/poiQuery.js')
      genStored = 6
      await getPoiGen()
      await vi.advanceTimersByTimeAsync(31_000)
      genStored = { then(resolve) { setTimeout(resolve, 60_000, 7) } } // R1: old value, lands late
      peekPoiGen()
      await vi.advanceTimersByTimeAsync(0)
      genStored = 8 // R2 after R1 times out: the loader bumped
      await vi.advanceTimersByTimeAsync(33_000)
      peekPoiGen()
      await vi.advanceTimersByTimeAsync(0)
      expect(peekPoiGen()).toBe(8)
      await vi.advanceTimersByTimeAsync(30_000) // R1 lands with 7
      expect(peekPoiGen()).toBe(8)
    } finally {
      vi.useRealTimers()
      genStored = null
    }
  })

  it('poiGen: a hostile KV value never makes getPoiGen reject', async () => {
    vi.resetModules()
    const { getPoiGen, peekPoiGen } = await import('../../../api/lib/poiQuery.js')
    genStored = { toString: 1, valueOf: 1 }
    expect(await getPoiGen()).toBe(0)
    expect(peekPoiGen()).toBe(0)
    genStored = null
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
        genStored = value
        expect(await getPoiGen()).toBe(want)
        expect(peekPoiGen()).toBe(want)
      }
    } finally {
      vi.useRealTimers()
      genStored = null
    }
  })

  it('peekFlags: synchronous, null only on a cold instance', async () => {
    vi.resetModules()
    const mod = await import('../../../api/lib/flags.js')
    expect(mod.peekFlags()).toBeNull()
    stored = { poiDbPct: 5 }
    await mod.getFlags()
    expect(mod.peekFlags().poiDbPct).toBe(5)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 31_000)
      expect(mod.peekFlags().poiDbPct).toBe(5) // past the TTL: last-known-good, refresh started
      vi.setSystemTime(Date.now() + 3_600_000)
      expect(mod.peekFlags().poiDbPct).toBe(5) // never null once warm
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
