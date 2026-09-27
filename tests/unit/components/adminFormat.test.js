import { describe, it, expect } from 'vitest'
import { timeAgo, formatDate, describeAction } from '../../../src/components/adminFormat.js'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const ago = (sec) => new Date(NOW - sec * 1000).toISOString()

describe('admin timeAgo', () => {
  it.each([
    [null, 'never'],
    ['garbage', 'never'],
    [ago(10), 'just now'],
    [ago(5 * 60), '5m ago'],
    [ago(3 * 3600), '3h ago'],
    [ago(2 * 86400), '2d ago'],
    [ago(60 * 86400), '2mo ago'],
    [ago(800 * 86400), '2y ago'],
    [new Date(NOW + 60000).toISOString(), 'just now'],
  ])('%s -> %s', (ts, out) => expect(timeAgo(ts, NOW)).toBe(out))

  it('formats dates in UK order and dashes missing ones', () => {
    expect(formatDate('2026-03-05T10:00:00Z')).toBe('5 Mar 2026')
    expect(formatDate(null)).toBe('—')
  })
})

describe('admin describeAction', () => {
  it('names the deleted account by username', () => {
    expect(describeAction({ action: 'user.delete', target_id: '7', metadata: { username: 'demo' } })).toBe('deleted account #7 (@demo)')
  })
  it('names the reported user, not the entity, for a ban via report', () => {
    expect(describeAction({ action: 'report.action.ban_user', target_type: 'contribution', target_id: '99', metadata: { reportedUserId: 5 } }))
      .toBe('banned user #5 (via report on contribution #99)')
  })
})
