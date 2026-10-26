import { describe, it, expect, vi } from 'vitest'

// Regression (26 Oct 2026): with the Wikidata image sized to Commons' 960 px thumb but
// passed on without its size, it tied the 330 px Wikipedia thumbnail and lost
const T = 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/GCT.jpg'
vi.mock('../../../src/utils/apiClient/wikipedia', () => ({
  fetchWikipediaSummary: async () => ({ image: `${T}/330px-GCT.jpg`, imageWidth: 330, imageHeight: 248, title: 'Grand Central Terminal', url: 'https://en.wikipedia.org/wiki/Grand_Central_Terminal' }),
  fetchWikidataImageInfo: async () => ({ url: `${T}/960px-GCT.jpg`, width: 960, height: 720 }),
  fetchWikidataImage: async () => `${T}/960px-GCT.jpg`,
  fetchWikipediaImage: async () => null,
}))

describe('enrichPlace image choice', () => {
  it('picks the 960 px Commons thumbnail over the 330 px Wikipedia one', async () => {
    const { enrichPlace } = await import('../../../src/utils/apiClient.js')
    const out = await enrichPlace({ id: 'gct-test', name: 'Grand Central Terminal', wikipedia: 'en:Grand Central Terminal', wikidata: 'Q11277' })
    expect(out.image).toBe(`${T}/960px-GCT.jpg`)
    expect(out.imageSource).toBe('wikidata')
  })
})
