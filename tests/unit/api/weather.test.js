import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../api/lib/cors.js', () => ({ withCors: h => h }))
vi.mock('../../../api/lib/rateLimit.js', () => ({ dropRateLimitHeaders: () => {} }))
const { default: handler, wmoFromSymbol } = await import('../../../api/weather.js')

async function call(query) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, end() { return this } }
  await handler({ method: 'GET', query }, res)
  return res
}
const met = (temp, symbol) => ({ ok: true, json: async () => ({ properties: { timeseries: [{ data: { instant: { details: { air_temperature: temp } }, next_1_hours: { summary: { symbol_code: symbol } } } }] } }) })

describe('wmoFromSymbol: every MET symbol code maps to a WMO code the app describes', () => {
  // MET's published legend (github.com/metno/weathericons legend.csv), misspellings included
  const LEGEND = ['clearsky', 'fair', 'partlycloudy', 'cloudy', 'lightrainshowers', 'rainshowers', 'heavyrainshowers', 'lightrainshowersandthunder',
    'rainshowersandthunder', 'heavyrainshowersandthunder', 'lightsleetshowers', 'sleetshowers', 'heavysleetshowers', 'lightssleetshowersandthunder',
    'sleetshowersandthunder', 'heavysleetshowersandthunder', 'lightsnowshowers', 'snowshowers', 'heavysnowshowers', 'lightssnowshowersandthunder',
    'snowshowersandthunder', 'heavysnowshowersandthunder', 'lightrain', 'rain', 'heavyrain', 'lightrainandthunder', 'rainandthunder',
    'heavyrainandthunder', 'lightsleet', 'sleet', 'heavysleet', 'lightsleetandthunder', 'sleetandthunder', 'heavysleetandthunder',
    'lightsnow', 'snow', 'heavysnow', 'lightsnowandthunder', 'snowandthunder', 'heavysnowandthunder', 'fog']
  const KNOWN = [0, 1, 2, 3, 45, 61, 63, 65, 71, 73, 75, 80, 81, 82, 95]
  it.each(LEGEND)('%s', code => {
    for (const suffix of ['', '_day', '_night', '_polartwilight']) expect(KNOWN).toContain(wmoFromSymbol(code + suffix))
  })
  it.each([['clearsky_day', 0], ['fair_night', 1], ['partlycloudy_day', 2], ['cloudy', 3], ['fog', 45], ['lightrain', 61], ['heavyrain', 65],
    ['rainshowers_day', 81], ['heavysnow', 75], ['lightsnowshowers_night', 71], ['rainandthunder', 95], ['sleet', 63]])('%s -> %i', (s, w) => expect(wmoFromSymbol(s)).toBe(w))
  it('unknown or missing is null', () => { expect(wmoFromSymbol(undefined)).toBeNull(); expect(wmoFromSymbol('volcano')).toBeNull() })
})

describe('GET /api/weather', () => {
  let fetchMock
  beforeEach(() => { fetchMock = vi.fn(async () => met(14.2, 'partlycloudy_day')); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('answers a cell with the WMO code, CDN-cached, credited, and asks MET politely', async () => {
    const res = await call({ lat: '51.5', lng: '-0.1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ temperature: 14.2, weatherCode: 2, source: 'Data from MET Norway' })
    expect(res.headers['Cache-Control']).toMatch(/public, s-maxage=1800/)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=51.5&lon=-0.1')
    expect(init.headers['User-Agent']).toMatch(/ROAM.*go-roam\.uk/)
  })

  it('redirects raw coordinates to their 0.1° cell (one CDN entry per ~10 km), without calling MET', async () => {
    const res = await call({ lat: '51.50735', lng: '-0.12776' })
    expect(res.statusCode).toBe(307)
    expect(res.headers.Location).toBe('/api/weather?lat=51.5&lng=-0.1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([{}, { lat: 'x', lng: '1' }, { lat: '91', lng: '0' }, { lat: '0', lng: '181' }])('400 for %j', async q => {
    expect((await call(q)).statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('MET down or odd answer: 502, never cached', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503 }))
    let res = await call({ lat: '51.5', lng: '-0.1' })
    expect(res.statusCode).toBe(502)
    expect(res.headers['Cache-Control']).toBe('no-store')
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) }))
    res = await call({ lat: '51.5', lng: '-0.1' })
    expect(res.statusCode).toBe(502)
  })
})

describe('GET /api/weather reads the current hour, not the forecast\'s first step', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  it('picks the latest step at or before now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T13:20:00Z'))
    const step = (time, temp, symbol) => ({ time, data: { instant: { details: { air_temperature: temp } }, next_1_hours: { summary: { symbol_code: symbol } } } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ properties: { timeseries: [
      step('2026-09-28T11:00:00Z', 10, 'clearsky_day'), step('2026-09-28T12:00:00Z', 11, 'cloudy'), step('2026-09-28T13:00:00Z', 12, 'rain'), step('2026-09-28T14:00:00Z', 13, 'fog')] } }) })))
    const res = await call({ lat: '51.5', lng: '-0.1' })
    expect(res.body).toMatchObject({ temperature: 12, weatherCode: 63 })
  })
})

describe('client and server agree on the cell (else every request pays a redirect)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each([[51.50735, -0.12776], [53.95, -1.05], [-33.8688, 151.2093], [0.04, -0.04], [55.9533, -3.1883]])('%f, %f', async (lat, lng) => {
    const fetchMock = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { fetchWeather } = await import('../../../src/utils/apiClient/weather.ts')
    await fetchWeather(lat, lng)
    const url = new URL(fetchMock.mock.calls[0][0], 'https://x')
    const q = Object.fromEntries(url.searchParams)
    vi.stubGlobal('fetch', vi.fn(async () => met(1, 'fog')))
    expect((await call(q)).statusCode).toBe(200) // served directly: no 307
  })
})
