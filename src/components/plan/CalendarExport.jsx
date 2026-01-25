/**
 * CalendarExport - Generate .ics files for adventure plans
 *
 * Creates downloadable calendar events for Google/Apple Calendar
 */

import { formatDistance as formatDistanceUtil } from '../../utils/distanceUtils'

/**
 * Format date to iCalendar format: YYYYMMDDTHHMMSS
 */
function formatICSDate(date) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${year}${month}${day}T${hours}${minutes}00`
}

/**
 * Escape special characters for iCalendar format
 */
function escapeICS(text) {
  if (!text) return ''
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Generate a unique ID for the event
 */
function generateUID() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}@roam.app`
}

/**
 * Generate .ics file content for a single stop
 */
function generateStopEvent(stop, index, distanceUnit = 'km') {
  const startDate = new Date(stop.scheduledTime)
  const endDate = new Date(startDate)
  endDate.setMinutes(endDate.getMinutes() + (stop.duration || 60))

  const location = stop.address || `${stop.lat}, ${stop.lng}`
  const description = [
    stop.type ? `Type: ${stop.type.replace(/_/g, ' ')}` : null,
    stop.distance ? `Distance: ${formatDistanceUtil(stop.distance, distanceUnit)}` : null,
    stop.lat && stop.lng ? `Maps: https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}` : null
  ].filter(Boolean).join('\\n')

  return [
    'BEGIN:VEVENT',
    `UID:${generateUID()}`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(startDate)}`,
    `DTEND:${formatICSDate(endDate)}`,
    `SUMMARY:${escapeICS(`Stop ${index + 1}: ${stop.name}`)}`,
    `DESCRIPTION:${escapeICS(description)}`,
    `LOCATION:${escapeICS(location)}`,
    `GEO:${stop.lat};${stop.lng}`,
    'STATUS:CONFIRMED',
    'END:VEVENT'
  ].join('\r\n')
}

/**
 * Generate complete .ics file content for an adventure plan
 */
export function generateICS(itinerary, planTitle = 'ROAM Adventure', distanceUnit = 'km') {
  if (!itinerary || itinerary.length === 0) {
    return null
  }

  const events = itinerary.map((stop, i) => generateStopEvent(stop, i, distanceUnit)).join('\r\n')

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ROAM//Adventure Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(planTitle)}`,
    events,
    'END:VCALENDAR'
  ].join('\r\n')

  return icsContent
}

/**
 * Download .ics file
 */
export function downloadICS(itinerary, planTitle = 'ROAM Adventure', distanceUnit = 'km') {
  const icsContent = generateICS(itinerary, planTitle, distanceUnit)

  if (!icsContent) {
    return false
  }

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${planTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
  return true
}

/**
 * Generate Google Calendar URL (opens in new tab)
 */
export function getGoogleCalendarUrl(stop) {
  const startDate = new Date(stop.scheduledTime)
  const endDate = new Date(startDate)
  endDate.setMinutes(endDate.getMinutes() + (stop.duration || 60))

  const formatGoogleDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: stop.name,
    dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
    details: `Part of your ROAM adventure\n\nMaps: https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`,
    location: stop.address || `${stop.lat}, ${stop.lng}`
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export default { generateICS, downloadICS, getGoogleCalendarUrl }
