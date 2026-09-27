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

export function sizedImageUrl(url) {
  const m = typeof url === 'string' ? url.trim().match(ORIGINAL) : null
  if (!m) return url
  const [, base, hash, name, ext] = m
  if (/geograph/i.test(name)) return url
  return `${base}/thumb/${hash}/${name}/960px-${name}${ext.toLowerCase() === 'svg' ? '.png' : ''}`
}
