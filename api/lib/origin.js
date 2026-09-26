// Base URL for server-side calls back into this app. In production that must
// be the public domain: the *.vercel.app deployment host is behind Vercel's
// SSO protection, so crons calling it got 401 and silently did nothing.
export function appOrigin(req) {
  if (process.env.VERCEL_ENV === 'production') return 'https://www.go-roam.uk'
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}
