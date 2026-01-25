/**
 * GET/PUT /api/users/preferences
 *
 * Manage user preferences for authenticated users.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query, queryOne } from '../lib/db.js'
import { applyRateLimit, RATE_LIMITS } from '../lib/rateLimit.js'

// Whitelist of allowed preference fields
const ALLOWED_FIELDS = [
  'defaultLocation',
  'searchRadiusKm',
  'preferredCategories',
  'travelMode',
  'freeOnly',
  'accessibilityMode',
  'openOnly',
  'localsPicks',
  'offPeak',
  'eventsRadius',
  'eventsSort',
  'eventsHideSoldOut',
  'eventsHideSeen',
  'interests'
]

// Valid values for enum fields
const VALID_TRAVEL_MODES = ['walking', 'driving', 'transit', 'dayTrip', 'explorer']
const VALID_EVENTS_SORT = ['recommended', 'date', 'distance', 'popularity']

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, user)
      case 'PUT': {
        // Rate limit preference updates
        const rateLimitError = applyRateLimit(req, res, RATE_LIMITS.API_WRITE, 'prefs:update')
        if (rateLimitError) {
          return res.status(rateLimitError.status).json(rateLimitError)
        }
        return await handlePut(req, res, user)
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('User preferences error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET - Retrieve user preferences
 */
async function handleGet(req, res, user) {
  let prefs = await queryOne(
    'SELECT * FROM user_preferences WHERE user_id = ?',
    [user.id]
  )

  // Create default preferences if none exist
  if (!prefs) {
    await query(
      'INSERT INTO user_preferences (user_id) VALUES (?)',
      [user.id]
    )
    prefs = await queryOne(
      'SELECT * FROM user_preferences WHERE user_id = ?',
      [user.id]
    )
  }

  return res.status(200).json({
    preferences: {
      defaultLocation: prefs.default_location_lat ? {
        lat: parseFloat(prefs.default_location_lat),
        lng: parseFloat(prefs.default_location_lng),
        name: prefs.default_location_name
      } : null,
      searchRadiusKm: prefs.search_radius_km,
      preferredCategories: prefs.preferred_categories || [],
      travelMode: prefs.travel_mode || 'walking',
      freeOnly: Boolean(prefs.free_only),
      accessibilityMode: Boolean(prefs.accessibility_mode),
      openOnly: Boolean(prefs.open_only),
      localsPicks: Boolean(prefs.locals_picks),
      offPeak: Boolean(prefs.off_peak),
      eventsRadius: prefs.events_radius || 25,
      eventsSort: prefs.events_sort || 'recommended',
      eventsHideSoldOut: Boolean(prefs.events_hide_sold_out),
      eventsHideSeen: Boolean(prefs.events_hide_seen),
      interests: prefs.interests || []
    }
  })
}

/**
 * PUT - Update user preferences
 */
async function handlePut(req, res, user) {
  // SECURITY: Only allow whitelisted fields
  const sanitizedBody = {}
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) {
      sanitizedBody[field] = req.body[field]
    }
  }

  const {
    defaultLocation,
    searchRadiusKm,
    preferredCategories,
    travelMode,
    freeOnly,
    accessibilityMode,
    openOnly,
    localsPicks,
    offPeak,
    eventsRadius,
    eventsSort,
    eventsHideSoldOut,
    eventsHideSeen,
    interests
  } = sanitizedBody

  // Validate enum fields
  if (travelMode !== undefined && !VALID_TRAVEL_MODES.includes(travelMode)) {
    return res.status(400).json({ error: 'Invalid travel mode' })
  }
  if (eventsSort !== undefined && !VALID_EVENTS_SORT.includes(eventsSort)) {
    return res.status(400).json({ error: 'Invalid events sort option' })
  }

  // Validate numeric fields
  if (searchRadiusKm !== undefined && (typeof searchRadiusKm !== 'number' || searchRadiusKm < 1 || searchRadiusKm > 200)) {
    return res.status(400).json({ error: 'Search radius must be between 1 and 200 km' })
  }
  if (eventsRadius !== undefined && (typeof eventsRadius !== 'number' || eventsRadius < 1 || eventsRadius > 200)) {
    return res.status(400).json({ error: 'Events radius must be between 1 and 200 km' })
  }

  // Validate array fields
  if (preferredCategories !== undefined && (!Array.isArray(preferredCategories) || preferredCategories.length > 20)) {
    return res.status(400).json({ error: 'Preferred categories must be an array with max 20 items' })
  }
  if (interests !== undefined && (!Array.isArray(interests) || interests.length > 20)) {
    return res.status(400).json({ error: 'Interests must be an array with max 20 items' })
  }

  // Ensure preferences row exists
  const existing = await queryOne(
    'SELECT id FROM user_preferences WHERE user_id = ?',
    [user.id]
  )

  if (!existing) {
    await query('INSERT INTO user_preferences (user_id) VALUES (?)', [user.id])
  }

  // Build dynamic update
  const updates = []
  const params = []

  if (defaultLocation !== undefined) {
    if (defaultLocation === null) {
      updates.push('default_location_lat = NULL, default_location_lng = NULL, default_location_name = NULL')
    } else {
      updates.push('default_location_lat = ?, default_location_lng = ?, default_location_name = ?')
      params.push(defaultLocation.lat, defaultLocation.lng, defaultLocation.name || null)
    }
  }

  if (searchRadiusKm !== undefined) {
    updates.push('search_radius_km = ?')
    params.push(searchRadiusKm)
  }

  if (preferredCategories !== undefined) {
    updates.push('preferred_categories = ?')
    params.push(JSON.stringify(preferredCategories))
  }

  if (travelMode !== undefined) {
    updates.push('travel_mode = ?')
    params.push(travelMode)
  }

  if (freeOnly !== undefined) {
    updates.push('free_only = ?')
    params.push(freeOnly ? 1 : 0)
  }

  if (accessibilityMode !== undefined) {
    updates.push('accessibility_mode = ?')
    params.push(accessibilityMode ? 1 : 0)
  }

  if (openOnly !== undefined) {
    updates.push('open_only = ?')
    params.push(openOnly ? 1 : 0)
  }

  if (localsPicks !== undefined) {
    updates.push('locals_picks = ?')
    params.push(localsPicks ? 1 : 0)
  }

  if (offPeak !== undefined) {
    updates.push('off_peak = ?')
    params.push(offPeak ? 1 : 0)
  }

  if (eventsRadius !== undefined) {
    updates.push('events_radius = ?')
    params.push(eventsRadius)
  }

  if (eventsSort !== undefined) {
    updates.push('events_sort = ?')
    params.push(eventsSort)
  }

  if (eventsHideSoldOut !== undefined) {
    updates.push('events_hide_sold_out = ?')
    params.push(eventsHideSoldOut ? 1 : 0)
  }

  if (eventsHideSeen !== undefined) {
    updates.push('events_hide_seen = ?')
    params.push(eventsHideSeen ? 1 : 0)
  }

  if (interests !== undefined) {
    updates.push('interests = ?')
    params.push(JSON.stringify(interests))
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No preferences to update' })
  }

  params.push(user.id)

  await query(
    `UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = ?`,
    params
  )

  return res.status(200).json({ success: true })
}
