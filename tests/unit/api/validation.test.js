import { describe, it, expect } from 'vitest'
import {
  validateCoordinates,
  parseCoordinates,
  validateCollectionName,
  validateEmoji,
  validatePlanTitle,
  validateContent,
  validateShareCode,
  validatePagination,
  validateId,
  validatePlaceId,
  sanitizeString,
  whitelistFields,
} from '../../../api/lib/validation.js'

describe('validateCoordinates', () => {
  it('accepts valid coordinates', () => {
    expect(validateCoordinates(51.5, -0.1).valid).toBe(true)
    expect(validateCoordinates(0, 0).valid).toBe(true)
    expect(validateCoordinates(-90, 180).valid).toBe(true)
    expect(validateCoordinates(90, -180).valid).toBe(true)
  })

  it('rejects non-numbers', () => {
    expect(validateCoordinates('51.5', -0.1).valid).toBe(false)
    expect(validateCoordinates(null, 0).valid).toBe(false)
    expect(validateCoordinates(NaN, 0).valid).toBe(false)
  })

  it('rejects out-of-range latitude', () => {
    expect(validateCoordinates(91, 0).valid).toBe(false)
    expect(validateCoordinates(-91, 0).valid).toBe(false)
  })

  it('rejects out-of-range longitude', () => {
    expect(validateCoordinates(0, 181).valid).toBe(false)
    expect(validateCoordinates(0, -181).valid).toBe(false)
  })
})

describe('parseCoordinates', () => {
  it('parses string inputs', () => {
    const r = parseCoordinates('51.5', '-0.1')
    expect(r.valid).toBe(true)
    expect(r.lat).toBe(51.5)
    expect(r.lng).toBe(-0.1)
  })

  it('passes through number inputs', () => {
    const r = parseCoordinates(51.5, -0.1)
    expect(r.valid).toBe(true)
    expect(r.lat).toBe(51.5)
  })

  it('rejects garbage strings', () => {
    expect(parseCoordinates('foo', 'bar').valid).toBe(false)
  })
})

describe('validateCollectionName', () => {
  it('accepts normal names', () => {
    expect(validateCollectionName('Weekend Spots').valid).toBe(true)
  })

  it('rejects empty / whitespace', () => {
    expect(validateCollectionName('').valid).toBe(false)
    expect(validateCollectionName('   ').valid).toBe(false)
    expect(validateCollectionName(null).valid).toBe(false)
  })

  it('rejects over 40 chars', () => {
    expect(validateCollectionName('x'.repeat(41)).valid).toBe(false)
    expect(validateCollectionName('x'.repeat(40)).valid).toBe(true)
  })

  it('rejects script-injection patterns', () => {
    expect(validateCollectionName('<script>alert(1)</script>').valid).toBe(false)
    expect(validateCollectionName('javascript:void(0)').valid).toBe(false)
    expect(validateCollectionName('data:text/html,foo').valid).toBe(false)
  })
})

describe('validateEmoji', () => {
  it('accepts a single emoji', () => {
    expect(validateEmoji('🌿').valid).toBe(true)
  })

  it('accepts compound (ZWJ) emoji', () => {
    expect(validateEmoji('👨‍👩‍👧').valid).toBe(true)
  })

  it('rejects empty', () => {
    expect(validateEmoji('').valid).toBe(false)
    expect(validateEmoji(null).valid).toBe(false)
  })

  it('rejects overly long strings', () => {
    expect(validateEmoji('🌿🌿🌿🌿🌿🌿🌿🌿🌿').valid).toBe(false)
  })

  it('rejects plain text', () => {
    expect(validateEmoji('abc').valid).toBe(false)
  })
})

describe('validatePlanTitle', () => {
  it('accepts a normal title', () => {
    expect(validatePlanTitle('Sunday in Bath').valid).toBe(true)
  })

  it('rejects empty', () => {
    expect(validatePlanTitle('').valid).toBe(false)
    expect(validatePlanTitle(null).valid).toBe(false)
  })

  it('rejects over 100 chars', () => {
    expect(validatePlanTitle('x'.repeat(101)).valid).toBe(false)
    expect(validatePlanTitle('x'.repeat(100)).valid).toBe(true)
  })

  it('rejects script injection', () => {
    expect(validatePlanTitle('<script>x</script>').valid).toBe(false)
  })
})

describe('validateContent', () => {
  it('accepts normal content', () => {
    expect(validateContent('Great place, lovely view').valid).toBe(true)
  })

  it('rejects empty', () => {
    expect(validateContent('').valid).toBe(false)
  })

  it('rejects over default 280 chars', () => {
    expect(validateContent('x'.repeat(281)).valid).toBe(false)
  })

  it('respects custom maxLength', () => {
    expect(validateContent('x'.repeat(50), 40).valid).toBe(false)
    expect(validateContent('x'.repeat(40), 40).valid).toBe(true)
  })

  it('rejects script injection', () => {
    expect(validateContent('<script>x</script>').valid).toBe(false)
  })
})

describe('validateShareCode', () => {
  it('accepts 12-16 char alphanumeric lowercase', () => {
    expect(validateShareCode('abc123def456').valid).toBe(true)
    expect(validateShareCode('abcdef1234567890').valid).toBe(true)
  })

  it('rejects too short / too long', () => {
    expect(validateShareCode('abc').valid).toBe(false)
    expect(validateShareCode('x'.repeat(17)).valid).toBe(false)
  })

  it('rejects uppercase / special chars', () => {
    expect(validateShareCode('ABC123DEF456').valid).toBe(false)
    expect(validateShareCode('abc-def-123!').valid).toBe(false)
  })

  it('rejects empty', () => {
    expect(validateShareCode('').valid).toBe(false)
    expect(validateShareCode(null).valid).toBe(false)
  })
})

describe('validatePagination', () => {
  it('defaults missing values', () => {
    const r = validatePagination(undefined, undefined)
    expect(r.valid).toBe(true)
    expect(r.limit).toBe(20)
    expect(r.offset).toBe(0)
  })

  it('parses string inputs', () => {
    const r = validatePagination('50', '100')
    expect(r.limit).toBe(50)
    expect(r.offset).toBe(100)
  })

  it('clamps limit to maxLimit', () => {
    const r = validatePagination(500, 0, 100)
    expect(r.limit).toBe(100)
  })

  it('rejects negative offset and defaults to 0', () => {
    const r = validatePagination(20, -5)
    expect(r.offset).toBe(0)
  })
})

describe('validateId', () => {
  it('accepts positive ints', () => {
    expect(validateId('42').id).toBe(42)
    expect(validateId(7).id).toBe(7)
  })

  it('rejects zero/negative/NaN', () => {
    expect(validateId(0).valid).toBe(false)
    expect(validateId(-1).valid).toBe(false)
    expect(validateId('abc').valid).toBe(false)
  })
})

describe('validatePlaceId', () => {
  it('accepts OSM-style IDs', () => {
    expect(validatePlaceId('node/12345').valid).toBe(true)
    expect(validatePlaceId('way/67890').valid).toBe(true)
    expect(validatePlaceId('relation/111').valid).toBe(true)
  })

  it('accepts plain numeric IDs', () => {
    expect(validatePlaceId('12345').valid).toBe(true)
  })

  it('accepts wiki IDs', () => {
    expect(validatePlaceId('wiki_12345678').valid).toBe(true)
  })

  it('rejects garbage', () => {
    expect(validatePlaceId('foo').valid).toBe(false)
    expect(validatePlaceId('').valid).toBe(false)
    expect(validatePlaceId(null).valid).toBe(false)
  })

  it('rejects overlong IDs', () => {
    expect(validatePlaceId('node/' + '9'.repeat(60)).valid).toBe(false)
  })
})

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello')
  })

  it('strips null bytes', () => {
    expect(sanitizeString('foo\0bar')).toBe('foobar')
  })

  it('returns empty for non-strings', () => {
    expect(sanitizeString(null)).toBe('')
    expect(sanitizeString(42)).toBe('')
  })
})

describe('whitelistFields', () => {
  it('keeps only allowed fields', () => {
    const result = whitelistFields(
      { id: 1, secret: 'shh', email: 'a@b.com' },
      ['id', 'email'],
    )
    expect(result).toEqual({ id: 1, email: 'a@b.com' })
  })

  it('returns empty for non-object', () => {
    expect(whitelistFields(null, ['x'])).toEqual({})
    expect(whitelistFields('str', ['x'])).toEqual({})
  })

  it('ignores fields not present on input', () => {
    expect(whitelistFields({ a: 1 }, ['a', 'b', 'c'])).toEqual({ a: 1 })
  })
})
