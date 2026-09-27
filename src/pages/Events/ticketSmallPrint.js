// Ticketing feeds often put the booking small print where the event
// description should be ("Under 14s must be accompanied by an adult...").
// On a card that reads as the event's pitch, so we hide it instead.
// Also numbered notes ("(1) BSL -- Saturday 16th May"), access performance
// notes and age suitability ("Suitable for ages 12+").
const SMALL_PRINT_START = /^\s*(\(\d+\)|under\s*\d+s?\b|tickets?\b|age\s+restrictions?\b|age\s+guidance\b|ages?\s+\d+|please\s+note\b|terms\b|t\s*&\s*cs?\b|strictly\b|over\s*\d+s?\s+only\b|no\s+refunds?\b|recommended\s+for\s+ages?\b)/i
const SMALL_PRINT_ANYWHERE = /must be accompanied|\bterms (and|&) conditions\b|\bt\s*&\s*cs\b|\bterms apply\b|per (person|household|transaction)\b|\bBSL\b|\bcaptioned\b|\brelaxed performance\b|\baudio[\s-]described\b|\bsuitable for (ages?|those aged|children aged)\s*\d/i

export function isTicketSmallPrint(text) {
  if (!text || typeof text !== 'string') return false
  return SMALL_PRINT_START.test(text) || SMALL_PRINT_ANYWHERE.test(text)
}
