import { describe, it, expect, vi, afterEach } from 'vitest'

// Regression 2026-09-27: during a Wikimedia throttle the resolver answered
// "no photo", phones saved that for 7 days, and cards stayed blank long after
// the throttle ended. A 'no photo' verdict is now retried after 6 hours;
// real photos are still kept for 7 days.
const place = { id: 'ttl-1', name: "Shaw's Corner", category: 'culture', lat: 51.84, lng: -0.26 }
const fresh = async () => { vi.resetModules(); return import('../../../src/utils/placeImage.js') } // new app session

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })

describe("'no photo' verdicts expire quickly", () => {
  it('asks again 6+ hours after a no-photo answer', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-27T17:00:00Z') })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: null }) }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await fresh()).resolvePlaceImageWithMeta(place)).toBe(null)

    vi.setSystemTime(new Date('2026-09-27T20:00:00Z')) // 3h later: still trusted
    await (await fresh()).resolvePlaceImageWithMeta(place)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ url: 'https://upload.wikimedia.org/shaw.jpg' }) }))
    vi.setSystemTime(new Date('2026-09-28T00:00:00Z')) // 7h later: retried, and the photo is back
    expect((await (await fresh()).resolvePlaceImageWithMeta(place)).url).toBe('https://upload.wikimedia.org/shaw.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a real photo for days without asking again', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-27T17:00:00Z') })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://upload.wikimedia.org/p.jpg' }) }))
    vi.stubGlobal('fetch', fetchMock)
    await (await fresh()).resolvePlaceImageWithMeta({ ...place, id: 'ttl-2' })
    vi.setSystemTime(new Date('2026-09-30T17:00:00Z'))
    expect((await (await fresh()).resolvePlaceImageWithMeta({ ...place, id: 'ttl-2' })).url).toBe('https://upload.wikimedia.org/p.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
