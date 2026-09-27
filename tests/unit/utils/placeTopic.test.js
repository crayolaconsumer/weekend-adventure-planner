import { describe, it, expect, vi, afterEach } from 'vitest'
import { isEventArticle, isEventEntity, isDistressingImage, meaningfulWords } from '../../../shared/placeTopic.mjs'
import { fetchWikipediaSummary, isWikiExcerpt } from '../../../src/utils/placeImage.js'

describe('placeTopic', () => {
  it('meaningfulWords drops place-type words, numbers and short words', () => {
    expect(meaningfulWords('9/11 Memorial & Museum')).toEqual([])
    expect(meaningfulWords("St John's Gardens")).toEqual(['john'])
  })

  it('isEventArticle: an event title not naming the place', () => {
    expect(isEventArticle({ title: 'September 11 attacks' }, '9/11 Memorial & Museum')).toBe(true)
    expect(isEventArticle({ title: 'September 11 attacks' })).toBe(true)
    expect(isEventArticle({ title: 'Battle of Hastings' }, 'Senlac Hill')).toBe(true)
    expect(isEventArticle({ title: 'Great Fire of London', description: 'major fire in 1666' }, 'Pudding Lane')).toBe(false)
    expect(isEventArticle({ title: 'Imperial War Museum', description: 'war museum' }, 'Imperial War Museum')).toBe(false)
    expect(isEventArticle({ title: 'Elizabeth Tower', description: 'clock tower in London' }, 'Big Ben')).toBe(false)
  })

  it('isEventEntity: event classes, or a point in time with no coordinates', () => {
    const claim = id => ({ mainsnak: { datavalue: { value: { id } } } })
    expect(isEventEntity({ claims: { P31: [claim('Q217327')] } })).toBe(true)
    expect(isEventEntity({ claims: { P31: [claim('Q5')], P585: [{}] } })).toBe(true)
    expect(isEventEntity({ claims: { P31: [claim('Q33506')], P625: [{}] } })).toBe(false)
    expect(isEventEntity(undefined)).toBe(false)
  })

  it('isDistressingImage looks at the file name only', () => {
    expect(isDistressingImage('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/WTC_smoking_on_9-11.jpeg/330px-WTC_smoking_on_9-11.jpeg')).toBe(true)
    expect(isDistressingImage('Train%20crash.jpg')).toBe(true)
    expect(isDistressingImage('https://crashpad.example.com/photo.jpg')).toBe(false)
    expect(isDistressingImage(null)).toBe(false)
  })
})

describe('client Wikipedia summary', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = body => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))

  it('returns null for an article about an event (regression: 9/11 Memorial showed the attacks article)', async () => {
    stub({ title: 'September 11 attacks', description: 'Islamist terrorist attacks in the United States', extract: 'The September 11 attacks…', thumbnail: 'https://upload.wikimedia.org/x/WTC_smoking_on_9-11.jpeg' })
    expect(await fetchWikipediaSummary('en:September 11 attacks t1', '9/11 Memorial & Museum')).toBe(null)
  })

  it('keeps the text but drops a distressing lead image', async () => {
    stub({ title: 'Old Pier', extract: 'A pier.', thumbnail: 'https://upload.wikimedia.org/x/Pier_burning_2003.jpg', thumbnailWidth: 1, thumbnailHeight: 1 })
    expect(await fetchWikipediaSummary('en:Old Pier t2', 'Old Pier')).toMatchObject({ extract: 'A pier.', thumbnail: null })
  })

  it('isWikiExcerpt spots the truncated extract enrichPlace uses as the description', () => {
    const extract = 'The National September 11 Memorial & Museum is a memorial and museum in New York City commemorating the attacks.'
    expect(isWikiExcerpt('The National September 11 Memorial & Museum is a memorial and museum in New York City...', extract)).toBe(true)
    expect(isWikiExcerpt('A museum run by volunteers.', extract)).toBe(false)
    expect(isWikiExcerpt('Anything', null)).toBe(false)
  })
})

describe('client Wikidata image', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('has no image for an event item (Q10806, September 11 attacks)', async () => {
    const { fetchWikidataImage } = await import('../../../src/utils/apiClient/wikipedia.ts')
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ entities: { Q10806: { claims: {
      P31: [{ mainsnak: { datavalue: { value: { id: 'Q217327' } } } }],
      P18: [{ mainsnak: { datavalue: { value: 'North face south tower after plane strike 9-11.jpg' } } }]
    } } } }) }))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchWikidataImage('Q10806')).toBe(null)
    expect(fetch).toHaveBeenCalledTimes(1) // never asked Commons for the file
  })
})

describe('critic cases (false positives and misses)', async () => {
  const { isEventArticle, isDistressingImage } = await import('../../../shared/placeTopic.mjs')
  it('an event-titled article sharing words with the place is still an event', () => {
    expect(isEventArticle({ title: 'September 11 attacks' }, 'National September 11 Memorial & Museum')).toBe(true)
  })
  it('war museums and war memorials keep their article', () => {
    expect(isEventArticle({ title: 'Imperial War Museum North' }, 'IWM North')).toBe(false)
    expect(isEventArticle({ title: 'Thiepval Memorial', description: 'War memorial' }, 'Somme memorial')).toBe(false)
  })
  it('only whole words count as distressing, and underscores separate words', () => {
    expect(isDistressingImage('WTC_smoking_on_9-11.jpeg')).toBe(true)
    expect(isDistressingImage('Crashaw_Gardens.jpg')).toBe(false)
    expect(isDistressingImage('Mary Rose wreck.jpg')).toBe(false)
  })
})
