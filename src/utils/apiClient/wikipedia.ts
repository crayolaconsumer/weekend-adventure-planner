/**
 * Wikipedia + Wikidata image / summary lookups.
 *
 * Pure REST calls — no managedFetch wrapper because the per-page summary
 * endpoint is heavily CDN-cached on Wikipedia's side and we hit it once
 * per place at most. The Wikidata path is two hops (entity → Commons URL)
 * because the bare P18 claim returns a filename that needs another lookup
 * to resolve into a usable image URL (Commons MD5-hash filenames make
 * direct URL construction unreliable).
 */

const WIKIPEDIA_API = 'https://en.wikipedia.org/api/rest_v1'

export interface WikipediaSummary {
  title: string
  extract: string | null
  extractShort: string | null
  image: string | null
  url: string | null
}

interface WikipediaSummaryResponse {
  title?: string
  extract?: string
  thumbnail?: { source?: string }
  originalimage?: { source?: string }
  content_urls?: { desktop?: { page?: string } }
}

interface WikidataEntity {
  claims?: {
    P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }>
  }
}

interface CommonsImageInfo {
  imageinfo?: Array<{ url?: string }>
}

/**
 * Truncate text to a maximum length at word boundary.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const truncated = text.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...'
}

/**
 * Fetch Wikipedia image for a place by article title.
 */
export async function fetchWikipediaImage(title: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${WIKIPEDIA_API}/page/summary/${encodeURIComponent(title)}`,
    )

    if (response.ok) {
      const data = await response.json() as WikipediaSummaryResponse
      return data.thumbnail?.source || data.originalimage?.source || null
    }
  } catch (error) {
    console.warn('Wikipedia image fetch failed:', error)
  }
  return null
}

/**
 * Fetch image from Wikimedia Commons via Wikidata.
 * Two-hop: Wikidata entity → Commons imageinfo (avoids MD5 hash issues).
 */
export async function fetchWikidataImage(wikidataId: string): Promise<string | null> {
  try {
    // Step 1: Get filename from Wikidata
    const response = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`,
    )
    if (!response.ok) return null

    const data = await response.json() as { entities?: Record<string, WikidataEntity> }
    const entity = data.entities?.[wikidataId]
    const imageClaim = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    if (!imageClaim) return null

    // Step 2: Get actual URL from Wikimedia Commons API
    const filename = imageClaim.replace(/ /g, '_')
    const commonsResponse = await fetch(
      `https://commons.wikimedia.org/w/api.php?` +
      `action=query&titles=File:${encodeURIComponent(filename)}` +
      `&prop=imageinfo&iiprop=url&format=json&origin=*`,
    )
    if (!commonsResponse.ok) return null

    const commonsData = await commonsResponse.json() as {
      query?: { pages?: Record<string, CommonsImageInfo> }
    }
    const pages = commonsData.query?.pages
    const page = pages ? Object.values(pages)[0] : null
    return page?.imageinfo?.[0]?.url || null
  } catch (error) {
    console.warn('Wikidata image fetch failed:', error)
    return null
  }
}

/**
 * Fetch Wikipedia summary/extract for a place.
 * Title can be "en:Article Name" format from OSM wikipedia tag — language
 * code is split off and used to switch to the matching ${lang}.wikipedia.org.
 */
export async function fetchWikipediaSummary(title: string): Promise<WikipediaSummary | null> {
  try {
    // Handle "en:Article Name" format from OSM tags
    let articleTitle = title
    let lang = 'en'

    if (title.includes(':')) {
      const [langCode, ...rest] = title.split(':')
      if (langCode.length === 2) {
        lang = langCode
        articleTitle = rest.join(':')
      }
    }

    const apiBase = `https://${lang}.wikipedia.org/api/rest_v1`
    const response = await fetch(
      `${apiBase}/page/summary/${encodeURIComponent(articleTitle)}`,
    )

    if (!response.ok) return null

    const data = await response.json() as WikipediaSummaryResponse

    return {
      title: data.title ?? articleTitle,
      extract: data.extract ?? null,
      extractShort: data.extract ? truncateText(data.extract, 150) : null,
      image: data.thumbnail?.source || data.originalimage?.source || null,
      url: data.content_urls?.desktop?.page || null,
    }
  } catch (error) {
    console.warn('Wikipedia summary fetch failed:', error)
    return null
  }
}
