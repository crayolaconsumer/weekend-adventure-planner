// node add-hd.mjs <key> <town> "<File:Commons title.jpg>" ...  (triples) -> downloads each photo and records it,
// with a credit built from Commons metadata, in hd-photos.json
import fs from 'node:fs'
import { strip, artist } from './credit.mjs'
import { downloadPhoto } from './download.mjs'

const hd = JSON.parse(fs.readFileSync('hd-photos.json'))
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i += 3) {
  const [key, town, title] = args.slice(i, i + 3)
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&titles=${encodeURIComponent(title)}`
  if (hd[key]?.title === title && fs.existsSync(`public/${hd[key].img}`)) { console.log(key, '| already have it'); continue }
  let body = ''
  for (let i = 0; i < 6 && !body.startsWith('{'); i++) { // Commons rate-limits bursts (and connections drop)
    if (i) await new Promise(r => setTimeout(r, 10000 * i))
    body = await fetch(u, { headers: { 'user-agent': 'ROAM-reels/1.0 (go-roam.uk)' } }).then(r => r.text()).catch(() => '')
  }
  const info = Object.values(JSON.parse(body).query.pages)[0].imageinfo[0]
  const img = `towns/${town}/${key}-hd.jpg`
  fs.mkdirSync(`public/towns/${town}`, { recursive: true })
  await downloadPhoto(info.url, `public/${img}`)
  hd[key] = { img, credit: `${artist(info.extmetadata.Artist?.value)} / ${strip(info.extmetadata.LicenseShortName?.value)}`, title }
  console.log(key, '|', hd[key].credit)
  fs.writeFileSync('hd-photos.json', JSON.stringify(hd, null, 1))
  await new Promise(r => setTimeout(r, 2000))
}
