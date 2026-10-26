// Case- and accent-insensitive match of a free-text query against a saved
// place's name, address, type and category label. Every word in the query
// must appear somewhere ("pub york" finds "The Golden Fleece, York").
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function matchesPlaceQuery(place, query) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const category = place?.category
  const haystack = fold([
    place?.name,
    place?.address,
    place?.type?.replace?.(/_/g, ' '),
    typeof category === 'string' ? category : category?.label,
  ].join(' '))
  return words.every(w => haystack.includes(w))
}
