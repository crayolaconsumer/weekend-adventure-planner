/**
 * Tell IndexNow search engines (Bing, Yandex, Seznam, Naver...; Bing also
 * feeds DuckDuckGo and ChatGPT search) about every URL in the live sitemap.
 * Google doesn't use IndexNow; submit the sitemap in Search Console for that.
 *
 *   node scripts/indexnow.mjs
 *
 * The key is the 32-hex file in public/ (served at go-roam.uk/<key>.txt,
 * which is how engines verify we own the site). Re-run after big sitemap
 * changes; engines ignore URLs they already know.
 */
import { readdirSync } from 'node:fs'

const SITE = 'https://www.go-roam.uk'
const keyFile = readdirSync(new URL('../public/', import.meta.url)).find(f => /^[0-9a-f]{32}\.txt$/.test(f))
if (!keyFile) throw new Error('No IndexNow key file (public/<32 hex>.txt)')
const key = keyFile.slice(0, -4)

const check = await fetch(`${SITE}/${keyFile}`)
if (!check.ok || (await check.text()).trim() !== key) throw new Error(`${SITE}/${keyFile} is not live yet; deploy first`)

const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text()
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
console.log(`submitting ${urls.length} URLs`)

// 10,000 URLs per request is the protocol limit
for (let i = 0; i < urls.length; i += 10000) {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'www.go-roam.uk', key, keyLocation: `${SITE}/${keyFile}`, urlList: urls.slice(i, i + 10000) })
  })
  // 200 = accepted, 202 = accepted pending key check; anything else is a problem
  console.log(`batch ${i / 10000 + 1}: ${res.status} ${res.status === 200 || res.status === 202 ? 'accepted' : await res.text()}`)
  if (res.status !== 200 && res.status !== 202) process.exitCode = 1
}
