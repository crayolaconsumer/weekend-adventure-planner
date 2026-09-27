// Link-preview bots (share-meta.js gives them time for a cold lookup) plus
// search and AI crawlers (town.js keeps them off the Ticketmaster quota).
const BOT = /\bbot\b|bot[/-]|crawl|spider|facebookexternalhit|whatsapp|slack|telegrambot|discord|linkedinbot|skype|embedly|pinterestbot|preview|mastodon|iframely|google-pagerenderer|googlebot|bingbot|yandex|duckduckbot|baiduspider|applebot|ahrefs|semrush|petalbot|gptbot|claudebot|ccbot|bytespider/i

export const isPreviewBot = req => BOT.test(req.headers?.['user-agent'] || '')
