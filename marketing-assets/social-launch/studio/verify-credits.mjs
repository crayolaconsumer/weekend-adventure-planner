// node verify-credits.mjs -> checks every on-screen photo credit in src/reels.json against Commons; exits 1 on mismatch
import fs from 'node:fs'
import { strip, artist } from './credit.mjs'

const reels = JSON.parse(fs.readFileSync('src/reels.json'))
const titleOf = {}
for (const v of Object.values(JSON.parse(fs.readFileSync('hd-photos.json')))) titleOf[v.img] = v.title
for (const t of fs.readdirSync('public/towns')) {
  const f = `public/towns/${t}/data.json`
  if (fs.existsSync(f)) for (const p of JSON.parse(fs.readFileSync(f)).places) titleOf[p.img] = decodeURIComponent(p.source.split('/wiki/')[1]).replace(/_/g, ' ')
}
const used = new Map()
for (const r of reels) for (const s of r.scenes) if (s.place) used.set(s.place.img, s.place.credit)
let bad = 0
const fix = process.argv.includes('--fix')
const fixes = {}
for (const [img, credit] of used) {
  const title = titleOf[img]
  if (!title) { console.log('NO SOURCE', img); bad++; continue }
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(title)}`
  let body
  for (let i = 0; i < 5; i++) { // Commons rate-limits bursts (and connections drop): back off and retry
    body = await fetch(u, { headers: { 'user-agent': 'ROAM-reels/1.0 (go-roam.uk)' } }).then(r => r.text()).catch(() => '') // network blips retry too
    if (body.startsWith('{')) break
    await new Promise(r => setTimeout(r, 5000 * (i + 1)))
  }
  const m = Object.values(JSON.parse(body).query.pages)[0].imageinfo[0].extmetadata
  await new Promise(r => setTimeout(r, 1500))
  const want = `${artist(m.Artist?.value)} / ${strip(m.LicenseShortName?.value)}`
  const ok = want === credit
  if (!ok) { bad++; fixes[img] = want }
  console.log(ok ? 'ok  ' : 'DIFF', img, '|', credit, ok ? '' : `| commons says: ${want}`)
}
console.log(`${used.size - bad}/${used.size} credits match Commons`)
if (fix && bad) {
  const hd = JSON.parse(fs.readFileSync('hd-photos.json'))
  for (const v of Object.values(hd)) if (fixes[v.img]) v.credit = fixes[v.img]
  fs.writeFileSync('hd-photos.json', JSON.stringify(hd, null, 1))
  for (const t of fs.readdirSync('public/towns')) {
    const f = `public/towns/${t}/data.json`
    if (!fs.existsSync(f)) continue
    const d = JSON.parse(fs.readFileSync(f))
    for (const p of d.places) if (fixes[p.img]) p.credit = fixes[p.img]
    fs.writeFileSync(f, JSON.stringify(d, null, 2))
  }
  console.log(`fixed ${bad}; re-run plan.mjs`)
}
process.exit(bad ? 1 : 0)
