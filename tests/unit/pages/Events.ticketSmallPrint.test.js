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
    '(1) BSL -- Saturday 16th May 2026 at 2.30pm',
    '(1) Suitable for ages 12 and over.',
    'Suitable for ages 8+. Under 16s must be accompanied.',
    'Captioned performance on Tuesday 12 May.',
    'Relaxed performance: Sunday 17 May, 1pm.',
    'Audio-described performance available.',
    'Ages 14+ only.',
    'Age guidance: 12+',
  ])('hides %s', text => {
    expect(isTicketSmallPrint(text)).toBe(true)
  })

  it.each([
    'A night of 60s hits from the original line-up.',
    'Family fun day with face painting and a bouncy castle.',
    'Ticketed talk on the history of the Minster.',
    'Suitable for all the family, with a live band and street food.',
    'The award-winning musical returns for 10 weeks only.',
  ])('keeps %s', text => {
    expect(isTicketSmallPrint(text)).toBe(false)
  })

  it('handles empty input', () => {
    expect(isTicketSmallPrint('')).toBe(false)
    expect(isTicketSmallPrint(null)).toBe(false)
  })
})

describe('normalizeTicketmasterEvent description', () => {
  it('never uses pleaseNote or small print info as the description', async () => {
    const { normalizeTicketmasterEvent } = await import('../../../src/utils/ticketmasterApi.js')
    expect(normalizeTicketmasterEvent({ id: 'a', pleaseNote: 'Please note: bags are searched.' }).description).toBe('')
    expect(normalizeTicketmasterEvent({ id: 'b', info: '(1) BSL -- Saturday 16th May 2026' }).description).toBe('')
    expect(normalizeTicketmasterEvent({ id: 'c', info: 'A night of 60s hits.', pleaseNote: 'No re-entry.' }).description).toBe('A night of 60s hits.')
  })
})
