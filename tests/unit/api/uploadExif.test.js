import { Buffer } from 'node:buffer'
import { describe, it, expect, vi } from 'vitest'

// Public contribution photos must not keep EXIF GPS.

vi.mock('../../../api/lib/auth.js', () => ({ requireAuth: vi.fn() }))
vi.mock('../../../api/lib/rateLimit.js', () => ({ applyRateLimit: () => null, RATE_LIMITS: {} }))
vi.mock('../../../api/lib/flags.js', () => ({ isFeatureEnabled: async () => true }))

const { stripJpegMetadata } = await import('../../../api/contributions/upload.js')

function segment(marker, payload) {
  const head = Buffer.alloc(4)
  head.writeUInt16BE(0xFF00 | marker, 0)
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}

// Little-endian TIFF: IFD0 { Orientation=6, GPSInfo -> GPS IFD { GPSLatitudeRef='N' } }
function exifWithGps() {
  const t = Buffer.alloc(8 + 2 + 24 + 4 + 2 + 12 + 4)
  t.write('II', 0, 'latin1')
  t.writeUInt16LE(42, 2)
  t.writeUInt32LE(8, 4)
  t.writeUInt16LE(2, 8)
  t.writeUInt16LE(0x0112, 10); t.writeUInt16LE(3, 12); t.writeUInt32LE(1, 14); t.writeUInt16LE(6, 18)
  t.writeUInt16LE(0x8825, 22); t.writeUInt16LE(4, 24); t.writeUInt32LE(1, 26); t.writeUInt32LE(38, 30)
  t.writeUInt32LE(0, 34)
  t.writeUInt16LE(1, 38)
  t.writeUInt16LE(0x0001, 40); t.writeUInt16LE(2, 42); t.writeUInt32LE(2, 44); t.write('N\0', 46, 'latin1')
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t])
}

const SOI = Buffer.from([0xFF, 0xD8])
const JFIF = segment(0xE0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'))
const XMP = segment(0xE1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<exif:GPSLatitude>51,30N</exif:GPSLatitude>', 'latin1'))
const DQT = segment(0xDB, Buffer.alloc(65, 1))
const SCAN = Buffer.concat([Buffer.from([0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0]), Buffer.from([0x12, 0xFF, 0x00, 0x34]), Buffer.from([0xFF, 0xD9])])

describe('stripJpegMetadata', () => {
  const input = Buffer.concat([SOI, JFIF, segment(0xE1, exifWithGps()), XMP, DQT, SCAN])
  const out = stripJpegMetadata(input)

  it('removes GPS from EXIF and XMP', () => {
    expect(out).not.toBeNull()
    expect(out.includes(Buffer.from([0x25, 0x88]))).toBe(false) // GPSInfo tag (LE)
    expect(out.includes(Buffer.from('GPSLatitude'))).toBe(false)
    expect(out.includes(Buffer.from('xap/1.0'))).toBe(false)
    expect(input.includes(Buffer.from([0x25, 0x88]))).toBe(true) // fixture sanity
  })

  it('keeps orientation, non-metadata segments and scan data byte-for-byte', () => {
    const app1 = out.indexOf(Buffer.from([0xFF, 0xE1]))
    expect(out.readUInt16BE(app1 + 28)).toBe(6) // Orientation value in rebuilt IFD0
    expect(out.includes(JFIF)).toBe(true)
    expect(out.includes(DQT)).toBe(true)
    expect(out.subarray(out.length - SCAN.length).equals(SCAN)).toBe(true)
  })

  it('drops EXIF entirely when orientation is normal', () => {
    const plain = Buffer.concat([SOI, segment(0xE1, Buffer.from('Exif\0\0MM\0\x2a\0\0\0\x08\0\0\0\0\0\0', 'latin1')), SCAN])
    expect(stripJpegMetadata(plain).equals(Buffer.concat([SOI, SCAN]))).toBe(true)
  })

  it('passes non-JPEG through and rejects truncated JPEG', () => {
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0])
    expect(stripJpegMetadata(png)).toBe(png)
    expect(stripJpegMetadata(Buffer.concat([SOI, segment(0xE1, exifWithGps())]).subarray(0, 30))).toBeNull()
  })
})
