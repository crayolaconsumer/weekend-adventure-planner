/**
 * Google Encoded Polyline decoder
 *
 * Decodes the "overview_polyline.points" string returned by the Google
 * Directions API into an array of [lat, lng] pairs suitable for
 * react-leaflet's <Polyline positions={...} />.
 *
 * Algorithm reference:
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * No external dependency - the format is a simple base64-ish delta encoding:
 * each coordinate delta is a signed integer (scaled by 1e5), split into
 * 5-bit chunks, each chunk OR'd with 0x20 if more chunks follow, then
 * offset by 63 to land in printable ASCII.
 */

/**
 * Decode an encoded polyline string
 *
 * @param {string} encoded - Encoded polyline (e.g. route.overview_polyline.points)
 * @param {number} [precision=5] - Decimal precision used by the encoder (Google uses 5)
 * @returns {Array<[number, number]>} Array of [lat, lng] pairs
 */
export function decodePolyline(encoded, precision = 5) {
  if (typeof encoded !== 'string' || encoded.length === 0) return []

  const factor = Math.pow(10, precision)
  const coordinates = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    lat += readDelta()
    lng += readDelta()
    coordinates.push([lat / factor, lng / factor])
  }

  return coordinates

  // Read one varint-encoded signed delta from the current index
  function readDelta() {
    let result = 0
    let shift = 0
    let byte

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)

    // Bit 0 carries the sign; the remaining bits carry the magnitude
    return (result & 1) ? ~(result >> 1) : (result >> 1)
  }
}

export default decodePolyline
