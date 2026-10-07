// Photo credit text from Commons extmetadata
export const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// "No machine-readable author provided. X~commonswiki assumed" -> X; "Photograph by X ." -> X; "Flickr:X aka Y" -> X; "Original uploader was X at en.wikipedia" -> X; "X from Town, Country" -> X
export const artist = v => {
  const raw = strip(v)
  const assumed = raw.match(/^No machine-readable author provided\.\s*(.+?)(?:~\w+)?\s+assumed/i)
  const a = (assumed ? assumed[1] : raw).replace(/\(.*?\)/g, '').replace(/^Photograph by\s+/i, '').replace(/^Flickr:\s*/i, '').replace(/\s+aka\s+.*$/i, '').replace(/^Original uploader was\s+/i, '').replace(/^User\s+(\S+)\s+on\s+\S*wikipedia.*$/i, '$1').replace(/\s+at\s+(\S+\s)?\S*wikipedia.*$/i, '').replace(/\s+from\s+[^,]+(,.*)?$/i, '').replace(/\s*\.$/, '').trim()
  return !a || /^No machine-readable/i.test(a) ? 'Wikimedia Commons' : a.slice(0, 32)
}
