// Link-preview bots (share-meta.js gives them time for a cold lookup) plus
// search and AI crawlers (town.js keeps them off the Ticketmaster quota).
const BOT = /\bbot\b|bot[/-]|crawl|spider|facebookexternalhit|whatsapp|slack|telegrambot|discord|linkedinbot|skype|embedly|pinterestbot|preview|mastodon|iframely|google-pagerenderer|googlebot|bingbot|yandex|duckduckbot|baiduspider|applebot|ahrefs|semrush|petalbot|gptbot|claudebot|ccbot|bytespider/i

export const isPreviewBot = req => BOT.test(req.headers?.['user-agent'] || '')

/**
 * Crawlers get cached answers only: they never trigger a live call to a free
 * upstream (Wikipedia, Commons, Overpass). Returns true once it has replied.
 */
export function refuseBotUpstream(req, res) {
  if (!isPreviewBot(req)) return false
  res.setHeader('Cache-Control', 'private, no-store')
  res.status(503).json({ error: 'cache-only for crawlers' })
  return true
}

// Indexers and AI crawlers (not link previews): they visit every page in the
// sitemap, so they get cached data only and never cause a live upstream call.
const CRAWLER = /googlebot|bingbot|yandex|duckduckbot|baiduspider|applebot|ahrefs|semrush|petalbot|gptbot|claudebot|ccbot|bytespider|crawl|spider/i
export const isSearchCrawler = req => CRAWLER.test(req.headers?.['user-agent'] || '')
