// node fetch-town.mjs <slug> [count]
// Live town page -> top places that have a Wikimedia photo -> public/towns/<slug>/{data.json, N.jpg}
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { strip, artist } from './credit.mjs'
import { downloadPhoto } from './download.mjs'

const [slug, countArg = '5'] = process.argv.slice(2)
const want = Number(countArg)
const UA = { 'user-agent': 'ROAM-reels/1.0 (go-roam.uk; support@go-roam.uk)' }
const out = `public/towns/${slug}`
fs.mkdirSync(out, { recursive: true })

const html = await (await fetch(`https://www.go-roam.uk/town/${slug}`, { headers: UA })).text()
const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
const townName = decode(html.match(/<h1[^>]*>([^<]+)</)?.[1] ?? slug).replace(/^Things to do in /, '')

// Page order = the app's ranking; heading before each list = its group
const places = []
let group = ''
for (const m of html.matchAll(/<h2[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)<\/h2>|data-img="([^"]+)"[\s\S]*?<span class="name">([^<]+)<\/span><span class="tag">([^<]+)</g)) {
  if (m[1]) { group = decode(m[1]); continue }
  const p = new URLSearchParams(decode(m[2]))
  if (p.get('wikidata')) places.push({ name: decode(m[3]), tag: decode(m[4]), group, wikidata: p.get('wikidata') })
}

const picked = []
for (const pl of places) {
  if (picked.length >= want) break
  const wd = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${pl.wikidata}.json`, { headers: UA })).json()
  const ent = wd.entities[Object.keys(wd.entities)[0]]
  const file = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
  if (!file) continue
  const ii = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1600&titles=${encodeURIComponent('File:' + file)}`, { headers: UA })).json()
  const info = Object.values(ii.query.pages)[0]?.imageinfo?.[0]
  if (!info || info.height > info.width * 1.6 || info.height < 1200) continue // too small to fill the 1080x1260 photo box sharply
  const meta = info.extmetadata
  const n = picked.length + 1
  await downloadPhoto(info.url, `${out}/${n}.jpg`)
  picked.push({
    ...pl, img: `towns/${slug}/${n}.jpg`,
    description: ent.descriptions?.en?.value ?? '',
    credit: `${artist(meta.Artist?.value)} / ${strip(meta.LicenseShortName?.value)}`,
    source: info.descriptionurl
  })
  console.log(n, pl.name, '|', pl.tag, '|', picked.at(-1).credit)
}
fs.writeFileSync(`${out}/data.json`, JSON.stringify({ slug, town: townName, total: places.length, places: picked }, null, 2))
console.log(`${townName}: ${picked.length}/${want} with photos (of ${places.length} wikidata places)`)
