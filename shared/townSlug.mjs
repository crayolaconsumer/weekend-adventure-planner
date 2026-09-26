// Town URL slugs. Shared so the app's search box and the server
// (api/lib/towns.js) always produce the same /town/<slug>.

// Letters NFD can't decompose into base + accent (Łódź, Ærøskøbing, Straße)
const TRANSLIT = { ł: 'l', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h' }

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[łøæœßđðþıħ]/g, c => TRANSLIT[c])
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

// Bounded so junk URLs can't be used to hammer Nominatim through us
function isValidSlug(slug) {
  return typeof slug === 'string' &&
    /^[a-z0-9]+(-[a-z0-9]+){0,5}$/.test(slug) &&
    slug.length >= 2 && slug.length <= 60
}

export { slugify, isValidSlug }
