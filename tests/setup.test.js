import { describe, it, expect } from 'vitest'

describe('test infrastructure', () => {
  it('runs sync assertions', () => {
    expect(1 + 1).toBe(2)
  })

  it('runs async assertions', async () => {
    const v = await Promise.resolve(42)
    expect(v).toBe(42)
  })

  it('has happy-dom globals', () => {
    expect(typeof document).toBe('object')
    expect(typeof window).toBe('object')
  })
})
