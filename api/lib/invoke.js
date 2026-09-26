// In-process calls between API handlers (no HTTP hop, no preview-protection
// issues, same code path as the public endpoint).

// Run a (req, res) API handler in-process and resolve its JSON body (null on non-200)
export function callJson(handler, query, ip) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      setHeader() {}, getHeader() {}, removeHeader() {},
      status(c) { this.statusCode = c; return this },
      json(body) { resolve(this.statusCode === 200 ? body : null); return this },
      end() { resolve(null); return this }
    }
    Promise.resolve(handler({ method: 'GET', query, headers: { 'x-forwarded-for': ip } }, res)).catch(() => resolve(null))
  })
}
