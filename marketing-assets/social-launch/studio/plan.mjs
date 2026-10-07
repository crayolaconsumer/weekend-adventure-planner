// node plan.mjs -> src/reels.json. Cuts land on detected beats of each track.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

// pick: [place index (1-based, from the live town page), one factual line or ''], label overrides the type chip
const HD = JSON.parse(fs.readFileSync('hd-photos.json'))
const hd = (k, pos) => ({ img: HD[k].img, credit: HD[k].credit, ...(pos && { pos }) })
const REELS = [
  { id: 'york-things', slug: 'york', track: 'life-of-riley', hook: ['Things to do in', 'York', 'beyond the Minster'], hookPhoto: hd('shambles2'),
    pick: [[1, 'Free. Home of Mallard.', hd('mallard', '12% 50%')], [3, 'The keep of York Castle', hd('clifford')], [12, 'The pub that floods', hd('kingsarms')], [2, 'Fine, we had to.', hd('minster2')]] },
  { id: 'edinburgh-things', slug: 'edinburgh', track: 'inspired', hook: ['Things to do in', 'Edinburgh', 'this weekend'], hookPhoto: hd('edsky', '42% 50%'),
    pick: [[1, 'Built on an ancient volcanic plug'], [2, 'Free. Home of Dolly the sheep'], [4, 'Rooftop views on the Royal Mile', { pos: '50% 0%' }], [6, "Arthur's Seat, right in the city"]] },
  { id: 'oxford-things', slug: 'oxford', track: 'funky-chunk', hook: ['Things to do in', 'Oxford', 'this weekend'], hookPhoto: hd('radcam'),
    pick: [[2, 'Designed by Christopher Wren', hd('sheldonian')], [3, "Free. Britain's first public museum", hd('ashmolean')], [4, "Britain's oldest botanic garden", { name: 'Oxford Botanic Garden', tag: 'Garden' }]] },
  { id: 'bath-things', slug: 'bath', track: 'happy-bee---surf', hook: ['Things to do in', 'Bath', 'this weekend'], hookPhoto: { img: 'towns/bath/6.jpg', credit: 'Infilms / Public domain' },
    pick: [[1, 'A Georgian townhouse, restored', { name: 'No. 1 Royal Crescent' }], [3, 'Art museum by Sydney Gardens', { pos: '50% 70%' }], [9, "In one of Bath's oldest houses"]] },
  { id: 'liverpool-things', slug: 'liverpool', track: 'funky-chunk', hook: ['Things to do in', 'Liverpool', 'this weekend'], hookPhoto: hd('liv-hook'),
    pick: [{ name: 'Royal Albert Dock', tag: 'Attraction', line: 'Opened in 1846, now shops and museums', photo: hd('liv-dock') },
      { name: 'The Beatles Story', tag: 'Museum', line: 'Fab Four history on the waterfront', photo: hd('liv-beatles') },
      { name: 'World Museum', tag: 'Museum', line: 'Free. Dinosaurs to a planetarium', photo: hd('liv-world') },
      { name: 'Liverpool Cathedral', tag: 'Landmark', line: "Britain's biggest cathedral", photo: hd('liv-cath', '62% 50%') }] },
  { id: 'manchester-things', slug: 'manchester', track: 'happy-bee---surf', hook: ['Things to do in', 'Manchester', 'this weekend'], hookPhoto: hd('man-hook'),
    pick: [{ name: 'Science and Industry Museum', tag: 'Museum', line: 'Free. Steam, mills and machines', photo: hd('man-sim') },
      { name: 'Manchester Art Gallery', tag: 'Gallery', line: 'Free art on Mosley Street', photo: hd('man-mag') },
      { name: 'National Football Museum', tag: 'Museum', line: 'In the glass Urbis building', photo: hd('man-nfm') },
      { name: 'Heaton Park', tag: 'Park', line: 'Over 600 acres of parkland', photo: hd('man-heaton') }] },
  { id: 'london-things', slug: 'london', track: 'inspired', hook: ['Things to do in', 'London', 'this weekend'], hookPhoto: hd('lon-hook'),
    pick: [{ name: 'British Museum', tag: 'Museum', line: 'Free. Home of the Rosetta Stone', photo: hd('lon-bm') },
      { name: 'Tate Modern', tag: 'Gallery', line: 'Free art in a power station', photo: hd('lon-tate') },
      { name: 'Natural History Museum', tag: 'Museum', line: 'Free. Say hi to Hope the whale', photo: hd('lon-nhm') }] },
  { id: 'glasgow-things', slug: 'glasgow', track: 'funin-and-sunin', hook: ['Things to do in', 'Glasgow', 'this weekend'], hookPhoto: hd('gla-hook'),
    pick: [{ name: 'Kelvingrove', tag: 'Museum', line: "Free. Home of Dalí's Christ", photo: hd('gla-kelv') },
      { name: 'Riverside Museum', tag: 'Museum', line: 'Free transport museum on the Clyde', photo: hd('gla-river') },
      { name: 'Glasgow Cathedral', tag: 'Landmark', line: 'Survived the Reformation almost intact', photo: hd('gla-cath') },
      { name: 'Botanic Gardens', tag: 'Garden', line: 'Free. The Kibble Palace glasshouse', photo: hd('gla-bot') }] },
  { id: 'brighton-things', slug: 'brighton', track: 'happy-bee---surf', hook: ['Things to do in', 'Brighton', 'this weekend'], hookPhoto: hd('bri-hook'),
    pick: [{ name: 'Royal Pavilion', tag: 'Attraction', line: "George IV's seaside palace", photo: hd('bri-pav') },
      [2, 'Next to the Royal Pavilion'], [1, 'Free, under the seafront arches']] },
  { id: 'bristol-things', slug: 'bristol', track: 'funin-and-sunin', hook: ['Things to do in', 'Bristol', 'this weekend'], hookPhoto: hd('bri2-hook'),
    pick: [{ name: 'Clifton Suspension Bridge', tag: 'Landmark', line: 'Brunel-designed bridge over Avon Gorge', photo: hd('bri2-csb') },
      { name: 'SS Great Britain', tag: 'Attraction', line: "Brunel's 1843 steamship", photo: hd('bri2-ssgb') },
      { name: 'Bristol Museum & Art Gallery', tag: 'Museum', line: 'Free, with a plane in the hall', photo: hd('bri2-bmag') },
      { name: 'We The Curious', tag: 'Museum', line: 'Science centre with a planetarium', photo: hd('bri2-wtc') }] },
  { id: 'cambridge-things', slug: 'cambridge', track: 'inspired', hook: ['Things to do in', 'Cambridge', 'this weekend'], hookPhoto: hd('cam-hook'),
    pick: [{ name: "King's College Chapel", tag: 'Landmark', line: 'Gothic chapel, built 1446-1515', photo: hd('cam-kings') },
      { name: 'Fitzwilliam Museum', tag: 'Museum', line: "Free. The university's art museum", photo: hd('cam-fitz') },
      { name: 'Botanic Garden', tag: 'Garden', line: '40 acres of gardens and glasshouses', photo: hd('cam-bot') }] },
  { id: 'leeds-things', slug: 'leeds', track: 'funky-chunk', hook: ['Things to do in', 'Leeds', 'this weekend'], hookPhoto: hd('lee-hook'),
    pick: [{ name: 'Kirkstall Abbey', tag: 'Historic', line: 'Free. 12th-century abbey ruins', photo: hd('lee-kirkstall') },
      { name: 'Royal Armouries', tag: 'Museum', line: 'Free. The national arms collection', photo: hd('lee-armouries') },
      { name: 'Leeds Art Gallery', tag: 'Gallery', line: 'Free art gallery', photo: hd('lee-gallery') },
      { name: 'Roundhay Park', tag: 'Park', line: 'Over 700 acres, with two lakes', photo: hd('lee-roundhay') }] },
  { id: 'birmingham-things', slug: 'birmingham', track: 'happy-bee---surf', hook: ['Things to do in', 'Birmingham', 'this weekend'], hookPhoto: hd('bir-hook'),
    pick: [{ name: 'Birmingham Museum & Art Gallery', tag: 'Museum', line: 'Free. Home of the Staffordshire Hoard', photo: hd('bir-bmag') },
      { name: 'Cadbury World', tag: 'Attraction', line: 'Chocolate tour in Bournville', photo: hd('bir-cadbury') },
      { name: 'Back to Backs', tag: 'Museum', line: 'Restored 1800s courtyard houses', photo: hd('bir-b2b') }] },
  { id: 'newcastle-things', slug: 'newcastle', track: 'life-of-riley', hook: ['Things to do in', 'Newcastle', 'this weekend'], hookPhoto: hd('new-hook'),
    pick: [{ name: 'Angel of the North', tag: 'Landmark', line: "Gormley's 20m angel, in Gateshead", photo: hd('new-angel') },
      { name: 'Great North Museum', tag: 'Museum', line: 'Free. Natural history and a T. rex', photo: hd('new-gnm') },
      { name: 'Laing Art Gallery', tag: 'Gallery', line: 'Free art gallery', photo: hd('new-laing') }] },
]

// App-flow reels: real screenshots from the live web app (capture-bored.mjs)
const APP_REELS = [] // I'm Bored reels cut in review: screen recordings with captions; revisit with native capture
const FPS = 60
// beats per place: the first continues the hook shot, then a 3-2 swing so cuts don't tick like a metronome
const RHYTHM = [5, 5, 5, 5, 5] // ~2.5s per place: name + line readable at a glance (2-3 beats felt like 2x speed)
const size = f => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number)

const out = REELS.map(r => {
  const town = fs.existsSync(`public/towns/${r.slug}/data.json`) ? JSON.parse(fs.readFileSync(`public/towns/${r.slug}/data.json`)) : { places: [] }
  const order = r.hookFrom ? [r.pick[r.hookFrom - 1], ...r.pick.filter((_, k) => k !== r.hookFrom - 1)] : r.pick
  const places = order.map(e => {
    const [i, line, photo] = Array.isArray(e) ? e : [null, e.line, { name: e.name, tag: e.tag, description: '', ...e.photo }]
    const p = { ...(i ? town.places[i - 1] : {}), ...photo }
    const [w, h] = size(`public/${p.img}`)
    return { name: p.name, tag: p.tag, description: p.description, credit: p.credit, img: p.img, w, h, line }
  })
  const beatsFile = JSON.parse(fs.readFileSync(`public/music/${r.track}.beats.json`))
  const beats = beatsFile.beats_from_best
  const name = r.hook[1].replace('?', '')
  const plan = [
    [4, { kind: 'hook', place: r.hookPhoto ? { ...places[0], ...r.hookPhoto } : places[0], lines: r.hook }],
    ...places.map((p, k) => [(r.rhythm ?? RHYTHM)[k], { kind: 'place', place: p, index: k + 1, of: places.length, label: r.label, continued: false }]),
    [4, { kind: 'cta', line: [`${name},`, 'sorted.'] }],
  ]
  let b = 0
  const cuts = [0]
  for (const [n] of plan) { b += n; cuts.push(Math.round(beats[b] * FPS)) }
  if (cuts.some(Number.isNaN)) throw new Error(`${r.id}: track window too short`)
  return { id: r.id, music: { file: `music/${r.track}.mp3`, start: beatsFile.best16_start, volume: 0.9 }, cuts, scenes: plan.map(p => p[1]), total: cuts.at(-1), track: r.track }
})
for (const a of APP_REELS) {
  const taps = JSON.parse(fs.readFileSync(`public/app/${a.town}-taps.json`))
  const beatsFile = JSON.parse(fs.readFileSync(`public/music/${a.track}.beats.json`))
  const plan = [
    ...a.steps.map(([n, img, prev, lines, tap, big]) => [n, { kind: 'screen', img: `app/${a.town}-${img}.png`, prev: prev === null ? undefined : `app/${a.town}-${prev}.png`, lines, tap: tap ? taps[tap] : undefined, big: !!big }]),
    [2, { kind: 'payoff', town: a.payoff.replace(',', ''), word: 'sorted.' }],
    [3, { kind: 'cta' }],
  ]
  let b = 0
  const cuts = [0]
  for (const [n] of plan) { b += n; cuts.push(Math.round(beatsFile.beats_from_best[b] * FPS)) }
  out.push({ id: a.id, music: { file: `music/${a.track}.mp3`, start: beatsFile.best16_start, volume: 0.9 }, cuts, scenes: plan.map(p => p[1]), total: cuts.at(-1), track: a.track })
}
fs.writeFileSync('src/reels.json', JSON.stringify(out, null, 1))
for (const r of out) console.log(r.id.padEnd(20), (r.total / FPS).toFixed(1) + 's', r.track)
