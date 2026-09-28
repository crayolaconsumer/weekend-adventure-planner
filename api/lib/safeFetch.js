// Fetch a page from a URL a user controls (a venue's "website" field) without
// letting it reach anything but the public internet: no localhost, private
// ranges, link-local/metadata addresses or the Lambda runtime API, on any hop.
// The address check runs in the socket's DNS lookup, so the IP we check is the
// IP we connect to (no DNS-rebinding gap). Default ports only; redirects are
// followed by hand and each hop is checked again.

import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const v4ToInt = ip => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0)
const V4_RANGES = V4_BLOCKED.map(([base, bits]) => [v4ToInt(base), 2 ** (32 - bits)])

function isPublicV4(ip) {
  const n = v4ToInt(ip)
  return !V4_RANGES.some(([start, size]) => n >= start && n < start + size)
}

function expandV6(ip) {
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  // an embedded IPv4 tail (::ffff:1.2.3.4) counts as two groups
  const toGroups = parts => parts.flatMap(p => (p.includes('.') ? [((v4ToInt(p) >>> 16) & 0xffff).toString(16), (v4ToInt(p) & 0xffff).toString(16)] : [p]))
  const hg = toGroups(h), tg = toGroups(t)
  const groups = ip.includes('::') ? [...hg, ...Array(8 - hg.length - tg.length).fill('0'), ...tg] : hg
  return groups.map(g => parseInt(g || '0', 16))
}

/** true only for globally routable unicast addresses */
export function isPublicAddress(ip) {
  const family = net.isIP(ip)
  if (family === 4) return isPublicV4(ip)
  if (family !== 6) return false
  const g = expandV6(ip.split('%')[0])
  if (g.length !== 8 || g.some(x => Number.isNaN(x))) return false
  if (g.every(x => x === 0)) return false // ::
  if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return false // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge the IPv4
  const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(v4)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return isPublicV4(v4)
  if ((g[0] & 0xfe00) === 0xfc00) return false // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false // documentation
  return (g[0] & 0xe000) === 0x2000 // 2000::/3 global unicast only
}

// dns.lookup-compatible: resolves, then refuses unless every address is public
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error(`blocked non-public address for ${hostname}`), { code: 'EBLOCKED' }))
    }
    if (options?.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

function checkUrl(url, anyPort) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  if (!anyPort && url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return isPublicAddress(host) // Node skips lookup for IP literals
  return !/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)
}

/**
 * GET a public web page. Resolves { url, status, contentType, body } where body
 * is at most maxBytes (reading stops early once stopWhen(text) is true), or null
 * when the URL, any redirect hop or any resolved address is not public, on
 * timeout, or on a network error.
 */
export async function fetchPublicPage(input, { headers = {}, timeoutMs = 5000, maxBytes = 256 * 1024, maxRedirects = 3, stopWhen = () => false, _lookup = publicLookup, _anyPort = false } = {}) {
  let url
  try { url = new URL(input) } catch { return null }
  const deadline = Date.now() + timeoutMs
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!checkUrl(url, _anyPort)) return null
    const res = await request(url, headers, deadline - Date.now(), maxBytes, stopWhen, _lookup)
    if (!res) return null
    if (res.status >= 300 && res.status < 400 && res.location) {
      try { url = new URL(res.location, url) } catch { return null }
      continue
    }
    return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body }
  }
  return null
}

function request(url, headers, timeoutMs, maxBytes, stopWhen, lookup) {
  if (timeoutMs <= 0) return Promise.resolve(null)
  return new Promise(resolve => {
    const lib = url.protocol === 'https:' ? https : http
    let done = false
    let req, timer
    const finish = value => { if (!done) { done = true; clearTimeout(timer); req?.destroy(); resolve(value) } }
    try {
      req = lib.get(url, { headers, lookup, agent: false }, res => {
      const status = res.statusCode || 0
      const location = res.headers.location
      const contentType = String(res.headers['content-type'] || '')
      if (status >= 300 && status < 400) return finish({ status, location, contentType, body: '' })
      const decoder = new TextDecoder('utf-8', { fatal: false })
      let body = ''
      let received = 0
      res.on('data', chunk => {
        received += chunk.length
        body += decoder.decode(chunk, { stream: true })
        if (received >= maxBytes || stopWhen(body)) finish({ status, contentType, body })
      })
      res.on('end', () => finish({ status, contentType, body }))
      res.on('error', () => finish(null))
    })
    } catch {
      return finish(null) // e.g. a header value http.get rejects synchronously
    }
    req.on('error', () => finish(null))
    timer = setTimeout(() => finish(null), timeoutMs)
  })
}
