// node in-app.mjs "Place, Town" ...  -> does ROAM's place query (api/lib/towns.js townOverpassQuery) include it?
// Looks the place up on Nominatim, reads its OSM tags, and applies the same tag filters the app uses.
const UA = { 'user-agent': 'ROAM-reels/1.0 (go-roam.uk; support@go-roam.uk)' }
const RULES = [
  t => /^(attraction|viewpoint|museum|gallery|zoo|theme_park|artwork|memorial)$/.test(t.tourism ?? ''),
  t => /^(castle|manor|monument|ruins|archaeological_site)$/.test(t.historic ?? ''),
  t => t.amenity === 'place_of_worship' && t.wikidata,
  t => /^(park|garden|nature_reserve|picnic_site)$/.test(t.leisure ?? ''),
  t => /^(wood|water|beach)$/.test(t.natural ?? ''),
  t => /^(cafe|restaurant|bar|pub)$/.test(t.amenity ?? ''),
]
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (const q of process.argv.slice(2)) {
  const hits = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, { headers: UA })).json()
  let found = null
  for (const h of hits) {
    const el = (await (await fetch(`https://api.openstreetmap.org/api/0.6/${h.osm_type}/${h.osm_id}.json`, { headers: UA })).json()).elements[0]
    const t = el.tags ?? {}
    if (t.name && RULES.some(r => r(t))) { found = { id: `${h.osm_type[0]}${h.osm_id}`, name: t.name, tags: Object.entries(t).filter(([k]) => /^(tourism|historic|amenity|leisure|natural|wikidata)$/.test(k)).map(e => e.join('=')).join(' ') }; break }
    await sleep(300)
  }
  console.log(found ? `IN   ${q} -> ${found.name} (${found.id}) ${found.tags}` : `OUT  ${q} (${hits.map(h => h.class + '=' + h.type).join(', ') || 'no match'})`)
  await sleep(1100) // Nominatim: max 1 request/second
}
