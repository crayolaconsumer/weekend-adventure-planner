/**
 * OSM image= tags usually hold a Commons ORIGINAL (upload.wikimedia.org/
 * wikipedia/commons/a/ab/Name.jpg): often 1-5 MB, which loads "dial-up
 * style" on a phone. Rewrite it to Wikimedia's 960 px thumbnail of the same
 * file (a standard size, so usually already cached): ~100-400 KB, same host,
 * still CORS-open, so the image and offline caches keep working. SVGs get
 * their PNG rendering. Every other URL (existing /thumb/ URLs, TIFF/PDF,
 * other hosts) passes through unchanged, and so do Geograph uploads: those
 * are <= 640 px, and Wikimedia UPSCALES a small original (106 KB -> 247 KB).
 */
const ORIGINAL = /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+\.(jpe?g|png|gif|webp|svg))$/i

// Commons' imageinfo API now appends ?utm_source=…&utm_content=original to the
// file URL; a query of only utm_* tracking params is dropped so it still sizes
// (each param is its own &-separated utm_ key, values can't hold & # or ?, so no backtracking blow-up)
const UTM_ONLY = /\?utm_[a-z]+=[^&#?]*(?:&utm_[a-z]+=[^&#?]*)*&?$/i

// Some OSM image= tags hold a Commons (or Wikipedia) FILE PAGE, not the image:
// http://commons.wikimedia.org/wiki/File:Canterbury_Cathedral.jpeg. An <img> can't
// show a web page (Canterbury Cathedral never had a photo). Special:FilePath on the
// same wiki redirects to the image itself, here at the 960 px step.
const FILE_PAGE = /^https?:\/\/((?:commons|[a-z-]{2,12})\.(?:m\.)?(?:wikimedia|wikipedia)\.org)\/wiki\/(?:File|Image):([^?#]+)$/i

export function sizedImageUrl(url) {
  const page = typeof url === 'string' ? url.trim().match(FILE_PAGE) : null
  if (page) return `https://${page[1].replace('.m.', '.')}/wiki/Special:FilePath/${page[2]}?width=960`
  const m = typeof url === 'string' ? url.trim().replace(UTM_ONLY, '').match(ORIGINAL) : null
  if (!m) return url
  const [, base, hash, name, ext] = m
  if (/geograph/i.test(name)) return url
  return `${base}/thumb/${hash}/${name}/960px-${name}${ext.toLowerCase() === 'svg' ? '.png' : ''}`
}
