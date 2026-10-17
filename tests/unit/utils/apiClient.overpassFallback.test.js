import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let fetchNearbyPlaces
beforeEach(async () => {
  vi.resetModules()
  ;({ fetchNearbyPlaces } = await import('../../../src/utils/apiClient.js'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const PROXY = '/api/places/overpass/nearby'
const PLACES = { elements: [{ type: 'node', id: 1, lat: 0, lon: -150, tags: { name: 'Cafe', amenity: 'cafe' } }] }
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
// A request that only ends when its signal aborts (a mirror at capacity holding it open)
const hang = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
const proxyCalls = fetchMock => fetchMock.mock.calls.filter(([url]) => url === PROXY).length

describe('Overpass fallback', () => {
  it('a failed proxy call does not skip the proxy next time (regression: Try again went to a dead Overpass for 60 s, 17 Oct)', async () => {
    let proxyUp = false
    const fetchMock = vi.fn(async url => {
      if (url === PROXY) return proxyUp ? json(PLACES) : new Response('', { status: 503 })
      return new Response('', { status: 502 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchNearbyPlaces(0, -150, 2000, null, null, { force: true })).rejects.toThrow()
    proxyUp = true
    const t = Date.now()
    await fetchNearbyPlaces(0, -150, 2000, null, null, { force: true })
    expect(proxyCalls(fetchMock)).toBe(2)
    expect(Date.now() - t).toBeLessThan(1000) // no 6 s gap before the retry
  })

  it('a mirror that never answers is given up on after 10 s instead of hanging the spinner', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url, { signal }) => (url === PROXY ? new Response('', { status: 503 }) : hang(signal)))
    vi.stubGlobal('fetch', fetchMock)
    const settled = fetchNearbyPlaces(0, -150, 2000, null, null, { force: true }).then(() => 'ok', () => 'failed')
    await vi.advanceTimersByTimeAsync(9_900)
    expect(await Promise.race([settled, 'pending'])).toBe('pending')
    await vi.advanceTimersByTimeAsync(200)
    expect(await settled).toBe('failed')
  })

  it('a caller cancel still stops the load instead of trying the next mirror', async () => {
    let mirrors = 0
    const fetchMock = vi.fn(async (url, { signal }) => {
      if (url === PROXY) return new Response('', { status: 503 })
      mirrors++
      return hang(signal)
    })
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const pending = fetchNearbyPlaces(0, -150, 2000, null, caller.signal, { force: true })
    await vi.waitFor(() => expect(mirrors).toBe(1))
    caller.abort()
    await expect(pending).rejects.toThrow()
    expect(mirrors).toBe(1)
  })
})
