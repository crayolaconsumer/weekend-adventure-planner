/**
 * GET /api/ads/sponsored
 *
 * Get active sponsored places to insert into the discovery feed.
 * Returns places that match the user's location and preferences.
 */

import { getUserFromRequest } from '../lib/auth.js'
import { query } from '../lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { lat, lng, category, limit = 3 } = req.query

    // Get current user if authenticated
    const user = await getUserFromRequest(req)

    // Build query for active sponsored places
    let sql = `
      SELECT
        sp.id as sponsored_id,
        sp.place_id,
        sp.place_data,
        sp.campaign_name,
        sp.target_categories,
        sp.target_radius_km,
        bp.business_name,
        bp.owner_response
      FROM sponsored_places sp
      JOIN business_profiles bp ON sp.business_id = bp.id
      WHERE sp.status = 'active'
        AND sp.start_date <= CURDATE()
        AND sp.end_date >= CURDATE()
        AND (sp.budget_total_pence = 0 OR sp.budget_spent_pence < sp.budget_total_pence)
    `

    const params = []

    // Filter by category if provided
    if (category) {
      sql += ` AND (sp.target_categories IS NULL OR JSON_CONTAINS(sp.target_categories, ?))`
      params.push(JSON.stringify(category))
    }

    // Order by random to distribute impressions fairly
    sql += ` ORDER BY RAND() LIMIT ?`
    params.push(parseInt(limit, 10))

    const sponsoredPlaces = await query(sql, params)

    // Parse place_data JSON and format response
    const results = sponsoredPlaces.map(sp => {
      const placeData = typeof sp.place_data === 'string'
        ? JSON.parse(sp.place_data)
        : sp.place_data

      // Calculate distance if user location provided
      let distance = null
      if (lat && lng && placeData.lat && placeData.lng) {
        distance = calculateDistance(
          parseFloat(lat),
          parseFloat(lng),
          placeData.lat,
          placeData.lng
        )
      }

      return {
        sponsored_id: sp.sponsored_id,
        place: {
          ...placeData,
          id: sp.place_id,
          distance,
          isSponsored: true,
          businessName: sp.business_name,
          ownerResponse: sp.owner_response
        }
      }
    })

    return res.status(200).json({
      sponsored: results,
      count: results.length
    })

  } catch (error) {
    console.error('Sponsored places error:', error)
    return res.status(500).json({ error: 'Failed to fetch sponsored places' })
  }
}

/**
 * Calculate distance between two coordinates in km (Haversine formula)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 10) / 10 // Round to 1 decimal place
}

function toRad(deg) {
  return deg * (Math.PI / 180)
}
