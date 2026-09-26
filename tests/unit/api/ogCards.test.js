// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { Buffer } from 'node:buffer'

vi.mock('../../../api/lib/db.js', () => ({
  queryOne: vi.fn(async () => ({ id: 7, title: 'Sunday in St Albans', username: 'james' })),
  query: vi.fn(async () => [{ place_data: JSON.stringify({ name: 'St Albans Cathedral' }) }, { place_data: JSON.stringify({ name: 'Verulamium Park' }) }, { place_data: 'not json' }])
}))

const lookupPlace = vi.fn(async () => ({ id: 'w815929296', name: 'Hatfield Park', kind: 'Park', icon: 'nature', where: 'Hatfield' }))
vi.mock('../../../api/lib/placeLookup.js', async orig => ({ ...(await orig()), lookupPlace: (...a) => lookupPlace(...a) }))

function res() {
  return { h: {}, setHeader(k, v) { this.h[k] = v }, status(c) { this.code = c; return this }, send(b) { this.body = b; return this }, end() { return this } }
}
const isPng = buf => Buffer.isBuffer(buf) && buf.length > 1000 && buf.subarray(1, 4).toString() === 'PNG'

// Fonts come from Google at runtime; in tests fetch fails, so the default font is used
globalThis.fetch = vi.fn(async () => { throw new Error('offline') })

describe('link preview images (regression: every card was an empty PNG on the Edge runtime)', () => {
  it('place card renders a real PNG from the place id', async () => {
    const { default: handler } = await import('../../../api/og/place.tsx')
    const r = res()
    await handler({ query: { id: 'w815929296' }, headers: {} }, r)
    expect(r.code).toBe(200)
    expect(r.h['Content-Type']).toBe('image/png')
    expect(isPng(r.body)).toBe(true)
  }, 20000)

  it('ignores text in the URL: junk ids get the generic card (no free text on a ROAM image)', async () => {
    const { default: handler } = await import('../../../api/og/place.tsx')
    const r = res()
    await handler({ query: { id: 'x', name: 'FREE MONEY CLICK HERE' }, headers: {} }, r)
    expect(isPng(r.body)).toBe(true)
    expect(r.h['Cache-Control']).toMatch(/s-maxage=3600/)
    expect(lookupPlace).not.toHaveBeenCalledWith('x', expect.anything())
  }, 20000)

  it('plan card renders from the database', async () => {
    const { default: handler } = await import('../../../api/og/plan.tsx')
    const r = res()
    await handler({ query: { code: 'abcdef123456' }, headers: {} }, r)
    expect(isPng(r.body)).toBe(true)
    expect(r.h['Cache-Control']).toMatch(/s-maxage=86400/)
  }, 20000)

  it('an invalid plan code gets a generic card, briefly cached', async () => {
    const { default: handler } = await import('../../../api/og/plan.tsx')
    const r = res()
    await handler({ query: { code: "x'--" }, headers: {} }, r)
    expect(isPng(r.body)).toBe(true)
    expect(r.h['Cache-Control']).toMatch(/s-maxage=600/)
  }, 20000)
})
