// Link-preview bots (share-meta.js gives them time for a cold lookup) plus
// search and AI crawlers (town.js keeps them off the Ticketmaster quota).
// `(?<!cu)bot[/-]`: "Cubot" is a phone brand, not a bot.
const BOT = /\bbot\b|(?<!cu)bot[/-]|crawl|spider|facebookexternalhit|whatsapp|slack|telegrambot|discord|linkedinbot|skype|embedly|pinterestbot|preview|mastodon|iframely|google-pagerenderer|googlebot|bingbot|yandex|duckduckbot|baiduspider|applebot|ahrefs|semrush|petalbot|gptbot|claudebot|ccbot|bytespider|googleother|google-inspectiontool|google-extended/i

export const isPreviewBot = req => BOT.test(req.headers?.['user-agent'] || '')

// Unfurlers that fetch one shared link when a person pastes it (iMessage sends
// facebookexternalhit). Every other bot is a crawler.
const LINK_PREVIEW = /facebookexternalhit|facebot|twitterbot|whatsapp|slackbot|telegrambot|discordbot|linkedinbot|google-pagerenderer|skypeuripreview|iframely|embedly|mastodon|pinterestbot/i

// Indexers and AI crawlers: they walk every page in the sitemap, so they get
// cached data only and never cause a live upstream call. Defined as "a bot
// that isn't a link preview" so new crawlers (Amazonbot, PerplexityBot,
// OAI-SearchBot, GoogleOther...) are covered without a list to maintain.
// Real people never reach this: a Chrome/Safari/WebView UA isn't a bot.
export const isSearchCrawler = req => {
  const ua = req.headers?.['user-agent'] || ''
  return BOT.test(ua) && !LINK_PREVIEW.test(ua) && !/\b(WhatsApp|Slack|discord|Skype)\/[\d.]+.*(Electron|Chrome|Safari)/i.test(ua)
}

/**
 * Crawlers get cached answers only: they never trigger a live call to a free
 * upstream (Wikipedia, Commons, Overpass). Returns true once it has replied.
 */
export function refuseBotUpstream(req, res) {
  if (!isSearchCrawler(req)) return false
  res.setHeader('Cache-Control', 'private, no-store')
  res.status(503).json({ error: 'cache-only for crawlers' })
  return true
}
