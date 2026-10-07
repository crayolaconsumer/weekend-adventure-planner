// Download a Commons original, retrying while Wikimedia rate-limits (it answers with an HTML error page),
// then scale it down to at most 2200px tall. node download.mjs <url> <out.jpg>
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const UA = 'ROAM-reels/1.0 (go-roam.uk; support@go-roam.uk)'
const isImage = b => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) // JPEG or PNG

export async function downloadPhoto(url, out, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const buf = Buffer.from(await (await fetch(url, { headers: { 'user-agent': UA } })).arrayBuffer())
    if (isImage(buf)) {
      fs.writeFileSync(`${out}.orig`, buf)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${out}.orig`, '-frames:v', '1', '-update', '1', '-vf', 'scale=-2:min(ih\\,2200)', '-q:v', '2', out])
      fs.rmSync(`${out}.orig`)
      return
    }
    await new Promise(r => setTimeout(r, 10000 * (i + 1)))
  }
  throw new Error(`rate-limited or not an image: ${url}`)
}

if (import.meta.url === `file://${process.argv[1]}`) await downloadPhoto(process.argv[2], process.argv[3])
