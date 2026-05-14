/**
 * Privacy resolution helpers — the single source of truth for "what
 * does it mean if a user has no user_privacy_settings row?"
 *
 * The schema column defaults (is_private_account DEFAULT 0, etc) describe
 * what a freshly-inserted bare row looks like in MySQL. New users are
 * created without a privacy row (signup doesn't insert one), so until
 * they visit Settings the answer to "are they private?" comes from JS,
 * not SQL.
 *
 * Treat a missing row as PUBLIC — matches Instagram / Twitter / TikTok
 * defaults. Users opt in to private via Settings → Privacy → Private
 * Account. This matches the schema defaults exactly, so a freshly
 * INSERTed bare row produces the same effective state as no row at all.
 *
 * Anywhere in the codebase that reads user_privacy_settings columns
 * should resolve through here. SQL queries that filter on the column
 * should use `COALESCE(..., FALSE)` for is_private_account (or the
 * equivalent), and LEFT JOIN so missing rows still get a default.
 */

export const PRIVACY_DEFAULTS = Object.freeze({
  isPrivateAccount: false,
  showInSearch: true,
  hideFollowersList: false,
  hideFollowingList: false,
  isMapPublic: false,
})

/**
 * Resolve a user_privacy_settings row (or null) into the user's effective
 * privacy state. Null/undefined row → secure defaults. A row's missing
 * column → that column's default.
 */
export function resolvePrivacy(row) {
  if (!row) return { ...PRIVACY_DEFAULTS }
  return {
    isPrivateAccount: row.is_private_account == null
      ? PRIVACY_DEFAULTS.isPrivateAccount
      : !!row.is_private_account,
    showInSearch: row.show_in_search == null
      ? PRIVACY_DEFAULTS.showInSearch
      : !!row.show_in_search,
    hideFollowersList: row.hide_followers_list == null
      ? PRIVACY_DEFAULTS.hideFollowersList
      : !!row.hide_followers_list,
    hideFollowingList: row.hide_following_list == null
      ? PRIVACY_DEFAULTS.hideFollowingList
      : !!row.hide_following_list,
    isMapPublic: row.is_map_public == null
      ? PRIVACY_DEFAULTS.isMapPublic
      : !!row.is_map_public,
  }
}

/**
 * Quick "is this account private?" check. Always treats missing row as
 * private. Use in place of `row?.is_private_account` for any decision
 * that gates exposure (follow-vs-request, content visibility, etc).
 */
export function isAccountPrivate(row) {
  return resolvePrivacy(row).isPrivateAccount
}

/**
 * Defaults for a new user_privacy_settings row created on a user's
 * first explicit save. Match PRIVACY_DEFAULTS so the row INSERT lands a
 * user in the same effective state they were in before saving — toggling
 * one setting never silently changes the others.
 */
export const NEW_ROW_DEFAULTS = Object.freeze({
  is_private_account: 0,
  show_in_search: 1,
  hide_followers_list: 0,
  hide_following_list: 0,
  is_map_public: 0,
})
