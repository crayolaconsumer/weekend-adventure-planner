/**
 * Object storage for the static POI blocks (shared/poiTiles.mjs). Two calls:
 *   get(key)                    -> Buffer, or null when the object doesn't exist
 *   getRange(key, start, end)   -> Buffer of bytes start..end INCLUSIVE (HTTP Range semantics)
 * Anything else (network, auth) throws; the query side turns that into "fall back".
 */
import { open, readFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { join, resolve, sep } from 'node:path'

/** A local directory laid out like the bucket (scripts/poi/tiles.mjs --out). */
export function localStore(dir) {
  const root = resolve(dir)
  const path = key => {
    const p = resolve(join(root, key))
    if (!p.startsWith(root + sep)) throw new Error(`bad key ${key}`)
    return p
  }
  return {
    async get(key) {
      try {
        return await readFile(path(key))
      } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
      }
    },
    async getRange(key, start, end) {
      const fh = await open(path(key), 'r')
      try {
        const buf = Buffer.alloc(end - start + 1)
        const { bytesRead } = await fh.read(buf, 0, buf.length, start)
        return buf.subarray(0, bytesRead)
      } finally {
        await fh.close()
      }
    },
  }
}

// RFC 3986 unreserved characters stay, everything else is %XX (what SigV4 signs)
const uriEncode = v => encodeURIComponent(v).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const xmlText = v => v.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e])
const sha256hex = data => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

/**
 * Cloudflare R2 (any S3-compatible store) with AWS SigV4, path-style, no SDK.
 * Env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com),
 * R2_BUCKET, optional R2_PREFIX (e.g. 'spike/') prepended to every key.
 * `put`, `head`, `list` and `delete` are for the upload script only: serving calls get/getRange,
 * so Vercel gets a read-only token (Object Read on this bucket).
 */
export function r2Store({ accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY,
  endpoint = process.env.R2_ENDPOINT, bucket = process.env.R2_BUCKET, prefix = process.env.R2_PREFIX || '',
  region = 'auto', fetchImpl = fetch, now = () => new Date(), timeoutMs = 5000 } = {}) {
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) throw new Error('R2 store needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET')
  const base = new URL(endpoint)

  // query: { name: value } for bucket-level calls (list); its canonical form is sorted and RFC 3986-encoded
  async function send(method, key, { range, body, headers: extra = {}, query = null } = {}) {
    const path = key === null ? `/${bucket}` : `/${bucket}/${(prefix + key).split('/').map(uriEncode).join('/')}`
    const qs = query ? Object.keys(query).sort().map(k => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&') : ''
    const amzDate = now().toISOString().replace(/[-:]|\.\d{3}/g, '') // 20261026T120000Z
    const day = amzDate.slice(0, 8)
    const payloadHash = body ? sha256hex(body) : 'UNSIGNED-PAYLOAD'
    const signed = { host: base.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    const names = Object.keys(signed).sort()
    const canonical = [method, path, qs, ...names.map(n => `${n}:${signed[n]}`), '', names.join(';'), payloadHash].join('\n')
    const scope = `${day}/${region}/s3/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n')
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', kSigning).update(toSign).digest('hex')
    const headers = {
      'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
      ...(range ? { Range: range } : {}), ...extra,
    }
    return fetchImpl(`${base.origin}${path}${qs ? `?${qs}` : ''}`, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
  }

  const fail = async (res, what) => {
    const text = await res.text().catch(() => '')
    // The body is S3 XML (Code/Message); never echo request headers
    throw new Error(`R2 ${what}: ${res.status} ${(/<Code>([^<]*)/.exec(text) || [])[1] || ''}`)
  }

  return {
    async get(key) {
      const res = await send('GET', key)
      if (res.status === 404) return null
      if (!res.ok) await fail(res, `GET ${key}`)
      return Buffer.from(await res.arrayBuffer())
    },
    async getRange(key, start, end) {
      const res = await send('GET', key, { range: `bytes=${start}-${end}` })
      if (res.status !== 206 && res.status !== 200) await fail(res, `GET ${key} ${start}-${end}`)
      const buf = Buffer.from(await res.arrayBuffer())
      // A 200 is the whole object (a server that ignored Range): cut it ourselves
      return res.status === 200 ? buf.subarray(start, end + 1) : buf
    },
    async put(key, body, contentType = 'application/octet-stream') {
      const res = await send('PUT', key, { body, headers: { 'Content-Type': contentType } })
      if (!res.ok) await fail(res, `PUT ${key}`)
    },
    async head(key) {
      const res = await send('HEAD', key)
      return res.ok
    },
    // Upload script only (scripts/poi/tilesUpload.mjs prune): every key under `under`, prefix stripped
    async list(under = '') {
      const keys = []
      let token = null
      do {
        const res = await send('GET', null, { query: { 'list-type': '2', prefix: prefix + under, ...(token ? { 'continuation-token': token } : {}) } })
        if (!res.ok) await fail(res, `LIST ${under}`)
        const xml = await res.text()
        for (const [, k] of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(k).slice(prefix.length))
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText((/<NextContinuationToken>([^<]*)</.exec(xml) || [])[1] || '') : null
      } while (token)
      return keys
    },
    async delete(key) {
      const res = await send('DELETE', key)
      if (!res.ok && res.status !== 404) await fail(res, `DELETE ${key}`)
    },
  }
}
