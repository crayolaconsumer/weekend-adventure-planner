import { describe, it, expect } from 'vitest'
import { displayEventTitle, isNonEvent, sortEvents, formatPriceRange } from '../../../src/utils/eventsApi.js'

describe('displayEventTitle', () => {
  it('title-cases an all-caps title', () => {
    expect(displayEventTitle("I LOVE REGGAETON - LONDON'S BIGGEST REGGAETON PARTY"))
      .toBe("I Love Reggaeton - London's Biggest Reggaeton Party")
  })

  it('keeps acronyms and numbers', () => {
    expect(displayEventTitle('BSL INTERPRETED TOUR OF THE MUSEUM')).toBe('BSL Interpreted Tour of the Museum')
    expect(displayEventTitle('90S R&B NIGHT WITH DJ SPOON')).toBe('90s R&B Night with DJ Spoon')
    expect(displayEventTitle('UB40 LIVE (HIP-HOP SPECIAL)')).toBe('UB40 Live (Hip-Hop Special)')
  })

  it('leaves mixed-case and short titles alone', () => {
    expect(displayEventTitle('Jazz at the Crypt')).toBe('Jazz at the Crypt')
    expect(displayEventTitle('The XX: Live')).toBe('The XX: Live')
    expect(displayEventTitle('ABC')).toBe('ABC')
  })
})

describe('isNonEvent', () => {
  it('drops gift cards, vouchers and redemptions', () => {
    expect(isNonEvent({ name: 'Gift Card Redemption' })).toBe(true)
    expect(isNonEvent({ name: 'O2 Academy gift card' })).toBe(true)
    expect(isNonEvent({ name: 'Theatre Voucher' })).toBe(true)
    expect(isNonEvent({ name: 'The Gift - a new play' })).toBe(false)
    expect(isNonEvent({ name: 'Cardiff Comedy Night' })).toBe(false)
  })
})

describe('sortEvents puts sold-out events last', () => {
  const ev = (id, extra) => ({ id, datetime: { start: new Date(2026, 9, id) }, ...extra })
  const list = [ev(1, { isSoldOut: true, score: 99, goingCount: 999 }), ev(2, { score: 1 }), ev(3, { score: 50 })]

  it.each(['recommended', 'soonest', 'nearest', 'popular'])('with %s sort', (sortBy) => {
    const out = sortEvents(list, sortBy)
    expect(out[out.length - 1].id).toBe(1)
    expect(out).toHaveLength(3)
  })
})

describe('formatPriceRange', () => {
  it('shows nothing when the price is unknown', () => {
    expect(formatPriceRange({ minPrice: null, currency: 'GBP' })).toBe('')
    expect(formatPriceRange({ currency: 'GBP' })).toBe('')
  })
  it('shows the price when known', () => {
    expect(formatPriceRange({ minPrice: 12.5, maxPrice: 20, currency: 'GBP' })).toBe('£12.50 - £20')
    expect(formatPriceRange({ isFree: true })).toBe('Free')
  })
})
