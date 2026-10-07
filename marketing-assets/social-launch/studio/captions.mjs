// node captions.mjs > captions.md   (one block per reel, copy-paste ready for TikTok + Instagram)
import fs from 'node:fs'
const reels = JSON.parse(fs.readFileSync('src/reels.json'))
const TITLE = { 'inspired': 'Inspired', 'funky-chunk': 'Funky Chunk', 'happy-bee---surf': 'Happy Bee - Surf', 'funin-and-sunin': 'Funin and Sunin', 'wholesome': 'Wholesome', 'life-of-riley': 'Life of Riley', 'happy-alley': 'Happy Alley' }
const credit = t => `🎵 "${TITLE[t]}" Kevin MacLeod (incompetech.com), licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/`
const tag = s => s.toLowerCase().replace(/[^a-z]/g, '')
const ASK = { things: 'Which one have you not done yet? 👇', gems: 'Been to any of these? Tell us a better one 👇', rainy: 'Save this for the next wet weekend ☔️' }
const out = ['# Captions (generated from the reel data by captions.mjs)', '',
  'Same caption on TikTok and Instagram. Hashtags capped at 5 on both. Keep the music credit line: it is the CC BY licence condition.', '']
const CUSTOM = {
  'bored-edinburgh': ["Bored this weekend? One tap 👇", "Tap I'm bored and ROAM picks somewhere real near you, how far it is and why it suits right now. In Edinburgh it found a view over Dean Village and the hike up Arthur's Seat. Not feeling it? Show another.", "What did it pick for you? 👇", '#thingstodoinedinburgh #edinburgh #boredideas #weekendplans #daysout'],
}
const EXTRA = [] // the shortened original reels were dropped in review (text in the caption zone)
const block = (id, secs, track, first, body, ask, tags, photos) => ['## ' + id + '.mp4' + (secs ? `  (${secs}s)` : ''), '', '```', first, '', body, 'Free on iPhone & Android, link in bio.', ask, '', credit(track), ...(photos ? [photos] : []), '', tags, '```', '']
for (const r of reels) {
  if (CUSTOM[r.id]) { const [f, b, a, t] = CUSTOM[r.id]; out.push(...block(r.id, (r.total / 60).toFixed(1), r.track, f, b, a, t)); continue }
  const kind = r.id.split('-').at(-1)
  const hook = r.scenes[0]
  const town = hook.lines[1].replace('?', '')
  const places = r.scenes.filter(s => s.kind === 'place').map(s => s.place)
  const first = { things: `Things to do in ${town} this weekend 👇`, gems: `Hidden gems in ${town} you've probably walked past 👇`, rainy: `Rainy day in ${town}? Things to do indoors 👇` }[kind]
  const tags = [`#thingstodoin${tag(town)}`, `#${tag(town)}`, kind === 'rainy' ? '#rainydayideas' : kind === 'gems' ? '#hiddengems' : '#weekendplans', '#daysout', '#ukdaysout']
  out.push(`## ${r.id}.mp4  (${(r.total / 60).toFixed(1)}s)`, '', '```', first, '',
    ...places.map((p, i) => `${i + 1}. ${p.name}${p.line && !p.line.startsWith('...') ? ` – ${p.line}` : ''}`), '',
    `All found on ROAM, the free app for things to do near you. iPhone & Android, link in bio.`, ASK[kind], '',
    credit(r.track), `📷 Photos: Wikimedia Commons (${[...new Set([hook.place, ...places].map(p => p.credit))].join('; ')})`, '',
    tags.join(' '), '```', '')
}
for (const [id, track, f, b, a, t] of EXTRA) out.push(...block(id, null, track, f, b, a, t, '📷 Place photos: Wikimedia Commons contributors (CC BY-SA)'))
console.log(out.join('\n'))
