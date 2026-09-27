import { describe, it, expect } from 'vitest'
import { isStandalonePathname } from '../../../src/utils/sharedLink'

// Regression: a first-time visitor to /privacy (store reviewers, policy links)
// got the onboarding welcome screen instead of the policy.
describe('isStandalonePathname', () => {
  it('lets legal and support pages skip onboarding', () => {
    for (const p of ['/privacy', '/terms', '/support', '/privacy/', '/get-roam', '/partners', '/partners/dashboard']) {
      expect(isStandalonePathname(p)).toBe(true)
    }
  })
  it('keeps onboarding for the app itself', () => {
    for (const p of ['/', '/events', '/place/123', '/privacy-extra', '/town/york']) {
      expect(isStandalonePathname(p)).toBe(false)
    }
  })
})
