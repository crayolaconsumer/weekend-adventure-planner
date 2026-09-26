import { describe, it, expect, vi, beforeEach } from 'vitest'

const track = vi.fn()
vi.mock('../../../src/utils/analytics', () => ({ track: (...a) => track(...a) }))
vi.mock('../../../src/utils/nativeBridge', () => ({
  isNative: () => false,
  getPublicShareUrl: path => `https://www.go-roam.uk${path}`
}))
vi.mock('../../../src/utils/imageCache', () => ({ getCachedImage: vi.fn() }))

const { sharePlaceLink, isShareablePlaceId } = await import('../../../src/utils/shareCard')
const place = { id: 'w815929296', name: 'Hatfield Park' }

beforeEach(() => { track.mockReset(); delete navigator.share })

describe('sharePlaceLink', () => {
  it('opens the share sheet with the public place URL and records it', async () => {
    navigator.share = vi.fn(async () => {})
    expect(await sharePlaceLink(place, 'visited')).toBe('shared')
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.go-roam.uk/place/w815929296' }))
    expect(track).toHaveBeenCalledWith('place_share', { source: 'visited', method: 'shared' })
  })

  it('reports "copied" when the share sheet errors and it falls back to the clipboard (regression: said "Shared")', async () => {
    navigator.share = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true })
    expect(await sharePlaceLink(place, 'saved')).toBe('copied')
    expect(track).toHaveBeenCalledWith('place_share', { source: 'saved', method: 'copied' })
  })

  it('says "I loved" for a place shared after a visit', async () => {
    navigator.share = vi.fn(async () => {})
    await sharePlaceLink(place, 'visited')
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ text: 'I loved Hatfield Park. Found it on ROAM.' }))
  })

  it('reports "copied" when it falls back to the clipboard, so the UI can say so', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true })
    expect(await sharePlaceLink(place, 'saved')).toBe('copied')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('https://www.go-roam.uk/place/w815929296'))
    expect(track).toHaveBeenCalledWith('place_share', { source: 'saved', method: 'copied' })
  })

  it('returns false and records a cancel when the user dismisses the sheet', async () => {
    navigator.share = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) })
    expect(await sharePlaceLink(place, 'saved')).toBe(false)
    expect(track).toHaveBeenCalledWith('place_share', { source: 'saved', method: 'cancelled' })
  })

  it('isShareablePlaceId: only ids /place/:id can load for someone else', () => {
    for (const id of [12345, '12345', 'w815929296', 'r3564020', 'n1']) expect(isShareablePlaceId(id)).toBe(true)
    for (const id of ['wiki_123', 'otm_N123', 'x1', '', undefined]) expect(isShareablePlaceId(id)).toBe(false)
  })
})
