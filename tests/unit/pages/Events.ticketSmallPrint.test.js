import { describe, it, expect } from 'vitest'
import { isTicketSmallPrint } from '../../../src/pages/Events/ticketSmallPrint.js'

describe('isTicketSmallPrint', () => {
  it.each([
    'Under 14s must be accompanied by an adult over 18. A max of 6 tickets per person and per household.',
    'Tickets are non-refundable.',
    'Age restriction: 18+',
    'Please note the venue has changed.',
    'Terms and conditions apply to all bookings.',
    'Great night out. Children must be accompanied by an adult.',
    'Limit of 4 per household.',
  ])('hides %s', text => {
    expect(isTicketSmallPrint(text)).toBe(true)
  })

  it.each([
    'A night of 60s hits from the original line-up.',
    'Family fun day with face painting and a bouncy castle.',
    'Ticketed talk on the history of the Minster.',
  ])('keeps %s', text => {
    expect(isTicketSmallPrint(text)).toBe(false)
  })

  it('handles empty input', () => {
    expect(isTicketSmallPrint('')).toBe(false)
    expect(isTicketSmallPrint(null)).toBe(false)
  })
})
