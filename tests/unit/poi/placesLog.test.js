// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { logPlaces } from '../../../api/lib/placesLog.js'

afterEach(() => vi.restoreAllMocks())

describe('logPlaces', () => {
  it('writes one parseable evt=places line with src, ms, n, bot', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    logPlaces({ headers: { 'user-agent': 'Mozilla/5.0' } }, Date.now() - 42, 'kv', 17)
    expect(log).toHaveBeenCalledTimes(1)
    const line = JSON.parse(log.mock.calls[0][0])
    expect(line).toMatchObject({ evt: 'places', src: 'kv', n: 17, bot: false })
    expect(line.ms).toBeGreaterThanOrEqual(42)
  })

  it('flags search crawlers', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    logPlaces({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }, Date.now(), '503')
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ src: '503', n: 0, bot: true })
  })

  it('never throws, even with no request or a broken console', () => {
    vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('boom') })
    expect(() => logPlaces(undefined, Date.now(), 'db', 1)).not.toThrow()
  })
})
