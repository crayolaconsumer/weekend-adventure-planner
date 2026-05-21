import { describe, expect, it } from 'vitest'
import { createPlatformBreakdown, mergePlatformBreakdown } from '../../../api/lib/cronRuns.js'

describe('cron run platform breakdown helpers', () => {
  it('starts with all supported platforms at zero', () => {
    expect(createPlatformBreakdown()).toEqual({
      web: { sent: 0, failed: 0 },
      ios: { sent: 0, failed: 0 },
      android: { sent: 0, failed: 0 }
    })
  })

  it('merges partial platform results without dropping missing platforms', () => {
    const target = createPlatformBreakdown()

    mergePlatformBreakdown(target, {
      web: { sent: 1, failed: 0 },
      ios: { sent: 0, failed: 2 }
    })

    expect(target).toEqual({
      web: { sent: 1, failed: 0 },
      ios: { sent: 0, failed: 2 },
      android: { sent: 0, failed: 0 }
    })
  })
})
