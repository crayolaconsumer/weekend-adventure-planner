/**
 * Privacy resolution helpers — the single source of truth for "what
 * does it mean if a user has no user_privacy_settings row?"
 *
 * The schema column defaults (is_private_account DEFAULT 0, etc) describe
 * what a freshly-inserted bare row looks like in MySQL, NOT what a user's
 * effective privacy state is when no row exists at all. New users are
 * created without a privacy row (signup doesn't insert one), so until they
 * visit Settings the answer to "are they private?" comes from JS, not SQL.
 *
 * Treat a missing row as the SECURE default — the user hasn't consented to
 * being public yet, so we don't expose them. This matches the comment in
 * api/users/[username].js: "Default to private if no settings exist
 * (opt-in to public)".
 *
 * Anywhere in the codebase that reads user_privacy_settings columns should
 * resolve through here. SQL queries that filter on the column should use
 * `COALESCE(..., TRUE)` for is_private_account (or the equivalent for
 * each field), and join via LEFT JOIN so missing rows still get a default.
 */

export const PRIVACY_DEFAULTS = Object.freeze({
  isPrivateAccount: true,
  // Searchable so other users can find you and send a follow request —
  // a private account that can't be searched is unreachable.
  showInSearch: true,
  hideFollowersList: true,
  hideFollowingList: true,
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
 * first explicit save. Match the "no row" semantics so a user toggling
 * a single unrelated field (e.g. isMapPublic) doesn't silently flip
 * their account from default-private to default-public.
 */
export const NEW_ROW_DEFAULTS = Object.freeze({
  is_private_account: 1,
  show_in_search: 1,
  hide_followers_list: 1,
  hide_following_list: 1,
  is_map_public: 0,
})
