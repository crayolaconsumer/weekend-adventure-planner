import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = { native: false, plugin: false, adsense: true, cardSlot: '123' }
vi.mock('../../../src/utils/nativeBridge', () => ({ isNative: () => env.native }))
vi.mock('../../../src/utils/nativeAd', () => ({ isNativeAdAvailable: () => env.native && env.plugin }))
vi.mock('../../../src/utils/adSense', () => ({
  isAdSenseConfigured: () => env.adsense,
  get ADSENSE_SLOT_CARD() { return env.cardSlot },
}))

const { mergeCards, slotsToRemove, adCardsEnabled, SPONSORED_INTERVAL } =
  await import('../../../src/components/cardStackSlots')

const places = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }))
const promo = (id) => ({ sponsored_id: id, place: { id: `s${id}` } })
const shape = (cards) => cards.map(c => (c.isAd ? c.slot : c.isSponsored ? `promo:${c.place.id}` : c.place.id))

describe('mergeCards', () => {
  it('puts a promoter in the slot when one is left, and backfills later slots with ads', () => {
    const out = shape(mergeCards({ places: places(24), sponsoredPlaces: [promo(1)], adsEnabled: true }))
    expect(out[8]).toBe('promo:s1')
    expect(out[17]).toBe('ad-2')
    expect(out[26]).toBe('ad-3')
    expect(out.length).toBe(27)
  })

  it('never makes the first card an ad or promoter', () => {
    for (let n = 0; n <= 20; n++) {
      const out = mergeCards({ places: places(n), sponsoredPlaces: [promo(1)], adsEnabled: true })
      if (out.length) expect(out[0].isAd || out[0].isSponsored).toBeFalsy()
    }
    expect(SPONSORED_INTERVAL).toBeGreaterThan(0)
  })

  it('gives premium users neither promoters nor ads', () => {
    const out = mergeCards({ places: places(24), sponsoredPlaces: [promo(1)], isPremium: true, adsEnabled: true })
    expect(out.every(c => !c.isAd && !c.isSponsored)).toBe(true)
  })

  it('keeps promoter placement unchanged when ads are off', () => {
    const out = shape(mergeCards({ places: places(24), sponsoredPlaces: [promo(1), promo(2)] }))
    expect(out[8]).toBe('promo:s1')
    expect(out[17]).toBe('promo:s2')
    expect(out.length).toBe(26)
  })

  it('leaves removed slots out without moving any earlier card', () => {
    const all = shape(mergeCards({ places: places(24), adsEnabled: true }))
    const trimmed = shape(mergeCards({ places: places(24), adsEnabled: true, removedSlots: new Set(['ad-2']) }))
    expect(all).toContain('ad-2')
    expect(trimmed).not.toContain('ad-2')
    const cut = all.indexOf('ad-2')
    expect(trimmed.slice(0, cut)).toEqual(all.slice(0, cut))
  })

  it('ads switched on mid-deck never shift cards the user has passed (regression)', () => {
    const before = shape(mergeCards({ places: places(24), adsEnabled: false }))
    const after = shape(mergeCards({ places: places(24), adsEnabled: true, adsFromIndex: 12 }))
    expect(after.slice(0, 12)).toEqual(before.slice(0, 12))
    expect(after).not.toContain('ad-1')
    expect(after).toContain('ad-2')
  })

  it('keeps slot ids stable as more places load', () => {
    const before = mergeCards({ places: places(10), adsEnabled: true }).filter(c => c.isAd)
    const after = mergeCards({ places: places(30), adsEnabled: true }).filter(c => c.isAd)
    expect(after[0].slot).toBe(before[0].slot)
  })
})

describe('slotsToRemove', () => {
  const cards = mergeCards({ places: places(24), adsEnabled: true }) // ad-1 at 8, ad-2 at 17, ad-3 at 26

  it('removes an unfilled slot ahead of the user', () => {
    expect(slotsToRemove(cards, 0, { 'ad-2': 'unfilled' })).toEqual(['ad-2'])
  })

  it('removes the top card if it is an ad not yet filled', () => {
    expect(slotsToRemove(cards, 8, {})).toEqual(['ad-1'])
    expect(slotsToRemove(cards, 8, { 'ad-1': 'loading' })).toEqual(['ad-1'])
    expect(slotsToRemove(cards, 8, { 'ad-1': 'filled' })).toEqual([])
  })

  it('leaves loading slots below the top alone', () => {
    expect(slotsToRemove(cards, 6, { 'ad-1': 'loading' })).toEqual([])
  })

  it('never touches slots the user has passed', () => {
    expect(slotsToRemove(cards, 9, { 'ad-1': 'unfilled' })).toEqual([])
  })
})

describe('adCardsEnabled', () => {
  beforeEach(() => Object.assign(env, { native: false, plugin: false, adsense: true, cardSlot: '123' }))

  it('is on for free web users when AdSense client and card slot are set', () => {
    expect(adCardsEnabled({ isPremium: false, authLoading: false })).toBe(true)
  })

  it('is off for premium and while auth is loading', () => {
    expect(adCardsEnabled({ isPremium: true, authLoading: false })).toBe(false)
    expect(adCardsEnabled({ isPremium: false, authLoading: true })).toBe(false)
  })

  it('is off on web without the card slot or client id', () => {
    env.cardSlot = null
    expect(adCardsEnabled({ isPremium: false, authLoading: false })).toBe(false)
    env.cardSlot = '123'
    env.adsense = false
    expect(adCardsEnabled({ isPremium: false, authLoading: false })).toBe(false)
  })

  it('on native depends only on the plugin being present', () => {
    env.native = true
    env.adsense = false
    expect(adCardsEnabled({ isPremium: false, authLoading: false })).toBe(false)
    env.plugin = true
    expect(adCardsEnabled({ isPremium: false, authLoading: false })).toBe(true)
  })
})

describe('ads switching on and off mid-deck', () => {
  it('keeps kept slots with ads off, so passed cards do not shift', () => {
    const on = shape(mergeCards({ places: places(24), adsEnabled: true }))
    const off = shape(mergeCards({ places: places(24), adsEnabled: false, keptSlots: new Set(['ad-1']) }))
    expect(off.slice(0, 10)).toEqual(on.slice(0, 10))
    expect(off).not.toContain('ad-2')
  })

  it('kept slots survive even when the user turns premium', () => {
    const out = shape(mergeCards({ places: places(16), isPremium: true, keptSlots: new Set(['ad-1']) }))
    expect(out[8]).toBe('ad-1')
  })
})

describe('slotsToRemove on web (pendingTopOk)', () => {
  const cards = mergeCards({ places: places(24), adsEnabled: true })
  it('keeps a top ad that is still filling, but still drops unfilled ones', () => {
    expect(slotsToRemove(cards, 8, {}, true)).toEqual([])
    expect(slotsToRemove(cards, 8, { 'ad-1': 'unfilled' }, true)).toEqual(['ad-1'])
  })
})
