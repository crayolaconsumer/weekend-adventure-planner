// node commons-search.mjs "<query>" <outdir>  -> candidates (h>=1500, free licence) as numbered thumbs + cands.json
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const [q, dir] = process.argv.slice(2)
const UA = { 'user-agent': 'ROAM-reels/1.0 (go-roam.uk; support@go-roam.uk)' }
fs.mkdirSync(dir, { recursive: true })
const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=400`
const pages = Object.values((await (await fetch(u, { headers: UA })).json()).query?.pages ?? {})
const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
const c = pages.map(p => ({ title: p.title, ...p.imageinfo?.[0] }))
  .filter(i => i.height >= 1500 && i.width >= i.height * 0.6 && /^(CC BY|CC0|Public domain)/i.test(strip(i.extmetadata?.LicenseShortName?.value)) && /\.jpe?g$/i.test(i.title))
  .slice(0, 8).map((i, k) => {
    execFileSync('curl', ['-sL', '-A', UA['user-agent'], '-o', `${dir}/${k}.jpg`, i.thumburl])
    return { k, title: i.title, w: i.width, h: i.height, url: i.url, thumburl: i.thumburl, page: i.descriptionurl,
      credit: `${strip(i.extmetadata?.Artist?.value).slice(0, 32) || 'Wikimedia Commons'} / ${strip(i.extmetadata?.LicenseShortName?.value)}` }
  })
fs.writeFileSync(`${dir}/cands.json`, JSON.stringify(c, null, 1))
console.log(q, c.length)
