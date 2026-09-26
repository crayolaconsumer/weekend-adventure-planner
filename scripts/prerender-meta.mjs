/**
 * Post-build: write dist/<route>/index.html for key public routes with a
 * real per-page <title>, meta description, OG/Twitter text and canonical,
 * so crawlers and link unfurlers see them without running JS. The SPA still
 * boots normally from each copy. vercel.json rewrites each route to its file.
 *
 * Keep ROUTES in sync with the matching rewrites in vercel.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { applyPageMeta } from '../shared/pageMeta.mjs'

const SITE = 'https://www.go-roam.uk'

const ROUTES = {
  '/events': {
    title: "What's On — local events near you | ROAM",
    description: 'Find gigs, markets, festivals and things to do near you this weekend. Swipe through local events and save the ones you want to go to.'
  },
  '/pricing': {
    title: 'Pricing — ROAM free and ROAM+ | ROAM',
    description: 'ROAM is free to use. Upgrade to ROAM+ for unlimited saves and lists, offline maps, a wider search radius and no ads.'
  },
  '/partners': {
    title: 'ROAM Partners — put your event in front of locals',
    description: 'Promote your event to people nearby who are actively looking for things to do. Simple, flat pricing for venues and organisers.'
  },
  '/get-roam': {
    title: 'Get ROAM — download for iPhone, Android and web',
    description: 'Get ROAM on the App Store, Google Play or the web. Swipe through curated local places and events, and get out there exploring.'
  },
  '/support': {
    title: 'Support | ROAM',
    description: 'Help with ROAM accounts, ROAM+ subscriptions, refunds and more. Contact support@go-roam.uk.'
  },
  '/privacy': {
    title: 'Privacy Policy | ROAM',
    description: 'How ROAM collects, uses and protects your data.'
  },
  '/terms': {
    title: 'Terms of Service | ROAM',
    description: 'The terms that apply when you use ROAM on the web, iPhone and Android.'
  }
}

const template = readFileSync('dist/index.html', 'utf8')

for (const [path, { title, description }] of Object.entries(ROUTES)) {
  const html = applyPageMeta(template, { title, description, url: `${SITE}${path}` })

  mkdirSync(`dist${path}`, { recursive: true })
  writeFileSync(`dist${path}/index.html`, html)
}

console.log(`prerender-meta: wrote ${Object.keys(ROUTES).length} routes`)
