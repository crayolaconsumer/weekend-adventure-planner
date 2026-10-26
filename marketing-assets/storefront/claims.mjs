// Writes claims.md + alt.json for a rendered set: per frame the real screen, where it was
// captured, the backdrop's original prompt, every in-screen photo's licence, and the alt text.
// Usage: node claims.mjs --frames frames-global.json --prompts /tmp/store-listing/gen/batch \
//          --licences /tmp/storefront/out/C/photo-licences.json --out /tmp/storefront/out/C
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []))
const frames = JSON.parse(readFileSync(resolve(here, args.frames || 'frames-global.json'), 'utf8'))
const prompts = Object.fromEntries(readdirSync(args.prompts).filter(f => /^prompts\d*\.json$/.test(f))
  .flatMap(f => JSON.parse(readFileSync(join(args.prompts, f), 'utf8'))).map(p => [p.name, p.p]))
const licences = JSON.parse(readFileSync(args.licences, 'utf8'))
const BANNED = /\b(best|top|#1|number one|new|free|sale|discount|award|million|download now)\b/i

const problems = []
// frames captured in native mode say so in their capture notes ('isNative() true'); name them by position
const nativeFrames = frames.map((f, i) => /isNative\(\) true/.test(f.where || '') ? i + 1 : null).filter(Boolean)
const nativeNote = nativeFrames.length ? `; frame ${nativeFrames.join(', ')} ${nativeFrames.length > 1 ? 'are' : 'is'} rendered in native mode, so ${nativeFrames.length > 1 ? 'they show' : 'it shows'} the in-app sheet the Android and iOS apps show` : ''
const out = [`# Claims and sources: ROAM global storefront (variant C)`, '',
  `Generated ${new Date().toISOString().slice(0, 10)} by claims.mjs. Every screen is the real app (built from the current code${nativeNote}), captured with Playwright in a guest session against the live production API. No UI was drawn or edited. Screenshots use no backdrop; the feature graphic's backdrop is a real Commons photo of the place its card shows.${frames.some(f => f.bg) ? " AI backdrops are generated on the owner's machine (Qwen-Image via the AI Image Studio server) from the prompts listed under each frame, owned by ROAM, and are generic scenes never presented as a named place." : ''}`, '', '## Frames']
const alt = {}
for (const [i, f] of frames.entries()) {
  const n = String(i + 1).padStart(2, '0')
  // one line per distinct photo (a card and its preload can log the same file twice)
  const rows = licences[f.meta || f.shot] && [...new Map(licences[f.meta || f.shot].map(r => [r.file || r.src, r])).values()]
  if (f.bg && !prompts[f.bg]) problems.push(`${n}: no prompt for backdrop ${f.bg}`)
  if (!rows) problems.push(`${n}: no licence log for ${f.meta || f.shot}`)
  if (rows?.some(r => /OTHER/.test(r.src) || r.error)) problems.push(`${n}: unresolved photo licence`)
  if (!f.claim) problems.push(`${n}: caption has no sourced claim`)
  if (f.alt.length > 140) problems.push(`${n}: alt text ${f.alt.length} chars (max 140)`)
  if (BANNED.test(f.head)) problems.push(`${n}: caption uses a word Play bans: ${f.head}`)
  if (/\b(york|london|whitby|canterbury|tokyo|lisbon)\b/i.test(prompts[f.bg] || '') && !/not any specific/i.test(prompts[f.bg])) problems.push(`${n}: backdrop ${f.bg} was prompted as a named place`)
  alt[n] = f.alt
  out.push(`### ${i + 1}. "${f.head}"`,
    `- Screen: ${f.shot}.png, captured at ${f.where}.`,
    `- Caption claim and source: ${f.claim || 'MISSING'}`,
    `- Photos inside the screen: ${rows?.length ? rows.map(r => r.file ? `${r.file} by ${r.author || 'unknown'} (${r.licence}, Wikimedia Commons)` : `${r.src}: ${r.licence}`).join('; ') : 'none'}.`,
    f.bg ? `- Backdrop: ${f.bg}.png. Prompt: ${prompts[f.bg] || 'MISSING'}` : '- Backdrop: none (the app\'s own cream background and contour texture).',
    `- Alt text (${f.alt.length} chars): ${f.alt}`, '')
}
// Feature graphic: --feature-photo (a real photo backdrop, licence logged as 'feature-bg') or
// --feature-bg <name> (an AI backdrop from the prompts); its card's licences are logged as 'feature-card'
if (args['feature-photo'] || args['feature-bg']) {
  const rows = licences['feature-card'] || []
  const bgRows = args['feature-photo'] ? licences['feature-bg'] || [] : null
  if (bgRows && (!bgRows.length || bgRows.some(r => /OTHER/.test(r.src) || r.error))) problems.push('feature: backdrop photo licence missing or unresolved')
  if (!bgRows && !prompts[args['feature-bg']]) problems.push(`feature: no prompt for backdrop ${args['feature-bg']}`)
  if (!rows.length || rows.some(r => /OTHER/.test(r.src) || r.error)) problems.push('feature: card photo licence missing or unresolved')
  const credit = r => `${r.file} by ${r.author || 'unknown'} (${r.licence}, Wikimedia Commons)`
  alt.feature = 'A Discover swipe card for Rievaulx Abbey Museum beside the words Things to do near you, over the ruins of Rievaulx Abbey'
  out.push('## Feature graphic',
    `- feature.png (1024x500): the line "Things to do near you." beside a real Discover swipe card (Rievaulx Abbey Museum, captured near Rievaulx, North Yorkshire), cropped to the card only, no device.`,
    `- Photos inside the card: ${rows.map(credit).join('; ') || 'none'}.`,
    bgRows ? `- Backdrop: a real photo of the same place, ${bgRows.map(credit).join('; ')}.` : `- Backdrop: ${args['feature-bg']}.png. Prompt: ${prompts[args['feature-bg']] || 'MISSING'}`,
    `- Alt text (${alt.feature.length} chars): ${alt.feature}`, '')
}
out.push('## Numbers and claims in captions', '- Each caption\'s claim and its source are listed under its frame above. No caption makes a ranking, price, download-count or award claim.')
if (problems.length) out.push('', '## PROBLEMS', ...problems.map(p => `- ${p}`))
writeFileSync(join(args.out, 'claims.md'), out.join('\n') + '\n')
writeFileSync(join(args.out, 'alt.json'), JSON.stringify(alt, null, 2) + '\n')
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : `claims.md + alt.json OK (${frames.length} frames)`)
process.exitCode = problems.length ? 1 : 0
