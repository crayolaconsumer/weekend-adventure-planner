import { describe, it, expect } from 'vitest'
import {
  resolvePrivacy,
  isAccountPrivate,
  PRIVACY_DEFAULTS,
  NEW_ROW_DEFAULTS,
} from '../../../api/lib/privacy.js'

describe('PRIVACY_DEFAULTS', () => {
  it('encodes the secure-by-default contract', () => {
    // These are load-bearing for every endpoint that reads privacy.
    // Any change here is a privacy policy change — update tests, schema,
    // and PrivacySettings UI together.
    expect(PRIVACY_DEFAULTS).toEqual({
      isPrivateAccount: true,
      showInSearch: true,
      hideFollowersList: true,
      hideFollowingList: true,
      isMapPublic: false,
    })
  })

  it('is frozen — guards against accidental drift', () => {
    expect(Object.isFrozen(PRIVACY_DEFAULTS)).toBe(true)
  })
})

describe('NEW_ROW_DEFAULTS', () => {
  it('matches PRIVACY_DEFAULTS so first-save toggle does not flip the account public', () => {
    // The privacy.js POST handler inserts these on a user's first save.
    // If they diverged from PRIVACY_DEFAULTS, toggling any single
    // unrelated field would silently flip is_private_account from
    // default-private to default-public.
    expect(NEW_ROW_DEFAULTS).toEqual({
      is_private_account: 1,
      show_in_search: 1,
      hide_followers_list: 1,
      hide_following_list: 1,
      is_map_public: 0,
    })
  })
})

describe('resolvePrivacy', () => {
  it('returns secure defaults for null row', () => {
    expect(resolvePrivacy(null)).toEqual(PRIVACY_DEFAULTS)
  })

  it('returns secure defaults for undefined row', () => {
    expect(resolvePrivacy(undefined)).toEqual(PRIVACY_DEFAULTS)
  })

  it('returns secure defaults for empty object (column missing from SELECT)', () => {
    expect(resolvePrivacy({})).toEqual(PRIVACY_DEFAULTS)
  })

  it('reads is_private_account as boolean', () => {
    expect(resolvePrivacy({ is_private_account: 1 }).isPrivateAccount).toBe(true)
    expect(resolvePrivacy({ is_private_account: 0 }).isPrivateAccount).toBe(false)
    expect(resolvePrivacy({ is_private_account: true }).isPrivateAccount).toBe(true)
    expect(resolvePrivacy({ is_private_account: false }).isPrivateAccount).toBe(false)
  })

  it('treats null column value as the secure default', () => {
    // MySQL TINYINT(1) can come back as null if the row was inserted
    // pre-schema-migration. Don't lose the secure default in that case.
    expect(resolvePrivacy({ is_private_account: null }).isPrivateAccount).toBe(true)
    expect(resolvePrivacy({ show_in_search: null }).showInSearch).toBe(true)
    expect(resolvePrivacy({ hide_followers_list: null }).hideFollowersList).toBe(true)
    expect(resolvePrivacy({ hide_following_list: null }).hideFollowingList).toBe(true)
    expect(resolvePrivacy({ is_map_public: null }).isMapPublic).toBe(false)
  })

  it('resolves a fully populated public-account row', () => {
    expect(resolvePrivacy({
      is_private_account: 0,
      show_in_search: 1,
      hide_followers_list: 0,
      hide_following_list: 0,
      is_map_public: 1,
    })).toEqual({
      isPrivateAccount: false,
      showInSearch: true,
      hideFollowersList: false,
      hideFollowingList: false,
      isMapPublic: true,
    })
  })

  it('resolves a fully populated locked-down private-account row', () => {
    expect(resolvePrivacy({
      is_private_account: 1,
      show_in_search: 0,
      hide_followers_list: 1,
      hide_following_list: 1,
      is_map_public: 0,
    })).toEqual({
      isPrivateAccount: true,
      showInSearch: false,
      hideFollowersList: true,
      hideFollowingList: true,
      isMapPublic: false,
    })
  })
})

describe('isAccountPrivate', () => {
  it('treats null row as private — the critical follow-vs-request gate', () => {
    // Regression test for the bug where private-by-default users were
    // instant-followed instead of generating a follow_request, because
    // POST /api/social did `if (privacySettings?.is_private_account)`
    // which reads null as falsy.
    expect(isAccountPrivate(null)).toBe(true)
  })

  it('treats undefined row as private', () => {
    expect(isAccountPrivate(undefined)).toBe(true)
  })

  it('treats explicit is_private_account=1 as private', () => {
    expect(isAccountPrivate({ is_private_account: 1 })).toBe(true)
  })

  it('treats explicit is_private_account=0 as public', () => {
    expect(isAccountPrivate({ is_private_account: 0 })).toBe(false)
  })

  it('treats the row-with-null-column case as private', () => {
    expect(isAccountPrivate({ is_private_account: null })).toBe(true)
  })

  it('matches the SQL COALESCE(is_private_account, TRUE) pattern used in queries', () => {
    // Search and discover queries return is_private via SQL COALESCE.
    // This helper drives the JS-side decisions. Both must agree on what
    // "no row" means or the UI and the API drift apart.
    const cases = [
      { row: null, sqlCoalesce: true },
      { row: { is_private_account: 1 }, sqlCoalesce: true },
      { row: { is_private_account: 0 }, sqlCoalesce: false },
    ]
    for (const c of cases) {
      expect(isAccountPrivate(c.row)).toBe(c.sqlCoalesce)
    }
  })
})
