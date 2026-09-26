// Rewrites the SEO / link-preview tags in the built index.html, so crawlers
// and link unfurlers (WhatsApp, iMessage, Facebook, X, Google) see a page's
// real title, description and image without running JS. Used at build time
// (scripts/prerender-meta.mjs) and per request (api/share-meta.js).

export const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function setAttr(html, selector, value) {
  // content may sit on the line after the attribute
  const re = new RegExp(`(<meta ${selector}\\s+content=")[^"]*(")`)
  if (!re.test(html)) throw new Error(`pageMeta: <meta ${selector}> not found in index.html`)
  // Function replacer: user text containing "$'" or "$&" must not act as a pattern
  return html.replace(re, (_, open, close) => open + value + close)
}

/** Returns index.html with this page's tags. image is optional; its size is unknown, so the template's size tags are dropped. */
export function applyPageMeta(template, { title, description, url, image, imageAlt }) {
  const t = escapeAttr(title)
  const d = escapeAttr(description)
  const u = escapeAttr(url)
  let html = template.replace(/<title>[^<]*<\/title>/, () => `<title>${t}</title>\n  <link rel="canonical" href="${u}" />`)
  html = setAttr(html, 'name="title"', t)
  html = setAttr(html, 'name="description"', d)
  html = setAttr(html, 'property="og:url"', u)
  html = setAttr(html, 'property="og:title"', t)
  html = setAttr(html, 'property="og:description"', d)
  html = setAttr(html, 'name="twitter:url"', u)
  html = setAttr(html, 'name="twitter:title"', t)
  html = setAttr(html, 'name="twitter:description"', d)
  if (image) {
    const i = escapeAttr(image)
    const alt = escapeAttr(imageAlt || title)
    html = setAttr(html, 'property="og:image"', i)
    html = setAttr(html, 'property="og:image:alt"', alt)
    html = setAttr(html, 'name="twitter:image"', i)
    html = setAttr(html, 'name="twitter:image:alt"', alt)
    html = html.replace(/\s*<meta property="og:image:(width|height)" content="[^"]*" \/>/g, '')
  }
  return html
}
