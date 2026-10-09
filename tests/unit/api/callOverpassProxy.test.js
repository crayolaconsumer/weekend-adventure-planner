import { it, expect, vi } from 'vitest'

// Regression: a /place lookup outliving the page's 1.5 s deadline had nothing keeping the
// instance alive; frozen mid-fetch, it failed when the instance woke minutes later (logged
// 21 min) and its answer never reached the cache
const held = []
vi.mock('@vercel/functions', async importOriginal => ({ ...(await importOriginal()), waitUntil: p => held.push(p) }))

const { callOverpassProxy } = await import('../../../api/town.js')

it('answers 504 at the deadline, and keeps the instance alive until the lookup ends', async () => {
  let finish
  const slowProxy = (req, res) => new Promise(resolve => { finish = () => { res.status(200).json({ elements: [] }); resolve() } })
  const out = await callOverpassProxy('[out:json];node(1);out;', '1.2.3.4', slowProxy, 10)
  expect(out).toEqual({ status: 504, body: null })
  expect(held).toHaveLength(1)
  let ended = false
  held[0].then(() => { ended = true })
  await Promise.resolve()
  expect(ended).toBe(false)
  finish()
  await held[0]
  expect(ended).toBe(true)
})
