import { it, expect, vi, beforeEach, afterEach } from 'vitest'

// The latest write for a place must be the server's last word, even when the
// user acts while a flush is running (critic probe, Oct 2026).
vi.mock('../../../src/utils/authToken', () => ({ getAuthToken: () => 'tok' }))
const { enqueue, flushOutbox, writeOrQueue } = await import('../../../src/utils/outbox')

const serverLog = []
let releaseFirst
beforeEach(() => {
  localStorage.clear(); serverLog.length = 0
  enqueue({ key: 'visited:z', url: '/api/users/visited', method: 'POST', body: { placeId: 'z' } })
  enqueue({ key: 'saved:x', url: '/api/places/saved', method: 'POST', body: { place: { id: 'x' } } })
  vi.stubGlobal('fetch', vi.fn((url, o) => {
    serverLog.push(`${o.method} ${url}`)
    if (url === '/api/users/visited') return new Promise(r => { releaseFirst = () => r(new Response('{}', { status: 201 })) })
    return Promise.resolve(new Response('{}', { status: 200 }))
  }))
})
afterEach(() => vi.unstubAllGlobals())

const lastForX = () => serverLog.filter(l => l.includes('saved')).at(-1)

it('an unsave during a flush is not overtaken by the stale queued save', async () => {
  const flushing = flushOutbox()
  await new Promise(r => setTimeout(r, 0)) // flush is sending visited:z
  const unsave = writeOrQueue({ key: 'saved:x', url: '/api/places/saved?placeId=x', method: 'DELETE' })
  releaseFirst()
  await flushing
  expect(await unsave).toBe('ok')
  expect(lastForX()).toBe('DELETE /api/places/saved?placeId=x')
  expect(serverLog).not.toContain('POST /api/places/saved') // the stale save is never sent
  expect(localStorage.getItem('roam_outbox')).toBeNull()
})

it('a snapshot entry replaced before the flush reaches it is skipped', async () => {
  const flushing = flushOutbox()
  await new Promise(r => setTimeout(r, 0))
  enqueue({ key: 'saved:x', url: '/api/places/saved?placeId=x', method: 'DELETE' }) // replaced, not sent yet
  releaseFirst()
  await flushing
  expect(serverLog).toEqual(['POST /api/users/visited'])
  expect(JSON.parse(localStorage.getItem('roam_outbox')).map(e => e.method)).toEqual(['DELETE']) // next flush sends it
})
