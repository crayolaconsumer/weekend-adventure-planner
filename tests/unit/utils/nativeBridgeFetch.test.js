import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// Vercel's CDN never serves or stores a cached copy for a request carrying
// Authorization, so native must not send the token to public routes.
describe('native fetch interceptor auth', () => {
  const realFetch = globalThis.fetch
  const seen = []

  beforeAll(async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' }
    localStorage.setItem('roam_auth_token', 'tok')
    globalThis.fetch = vi.fn(async (url, init) => { seen.push({ url, auth: new Headers(init?.headers).get('Authorization') }); return new Response('{}') })
    const { installFetchInterceptor } = await import('../../../src/utils/nativeBridge.ts')
    installFetchInterceptor()
  })

  afterAll(() => {
    globalThis.fetch = realFetch
    delete window.Capacitor
    localStorage.removeItem('roam_auth_token')
  })

  const authFor = async (path, init) => {
    seen.length = 0
    await fetch(path, init)
    return seen[0]
  }

  it.each([
    '/api/places/image-resolve?name=York%20Minster&lat=53.96&lng=-1.08',
    '/api/wikipedia/summary?tag=en:York_Minster',
    '/api/events/ticketmaster?lat=53.96&lng=-1.08',
    '/api/events/skiddle?lat=53.96&lng=-1.08',
    '/api/flags',
    '/api/push/vapid-public-key',
  ])('sends no token to public %s', async path => {
    const r = await authFor(path)
    expect(r.url).toBe(`https://www.go-roam.uk${path}`)
    expect(r.auth).toBeNull()
  })

  it.each(['/api/notifications', '/api/places/saved', '/api/users/stats', '/api/contributions?placeId=node/1', '/api/places/trending?limit=10', '/api/flagsx'])(
    'still sends the token to %s', async path => {
      expect((await authFor(path)).auth).toBe('Bearer tok')
    })

  it('keeps an explicit Authorization a caller set', async () => {
    expect((await authFor('/api/flags', { headers: { Authorization: 'Bearer own' } })).auth).toBe('Bearer own')
  })
})
