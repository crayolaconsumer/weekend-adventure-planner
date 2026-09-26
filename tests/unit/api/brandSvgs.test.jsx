/**
 * The server-rendered town pages (api/town.js) can't import JSX, so they use
 * CategoryIcon medallions pre-rendered into api/lib/brandSvgs.js. This test
 * keeps that file identical to the component. After changing CategoryIcon:
 *
 *   UPDATE_BRAND_SVGS=1 npx vitest run tests/unit/api/brandSvgs.test.jsx
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { renderToStaticMarkup } from 'react-dom/server'
import CategoryIcon from '../../../src/components/icons/CategoryIcon'
import { CATEGORY_SVGS } from '../../../api/lib/brandSvgs.js'

const NAMES = ['food', 'nature', 'culture', 'historic', 'entertainment']
// Just the <svg>; the component's wrapper span is React-specific styling
const render = name => renderToStaticMarkup(<CategoryIcon name={name} size={32} />).match(/<svg[\s\S]*<\/svg>/)[0]

describe('api/lib/brandSvgs.js', () => {
  it('matches CategoryIcon exactly', () => {
    const current = Object.fromEntries(NAMES.map(n => [n, render(n)]))
    if (process.env.UPDATE_BRAND_SVGS) {
      writeFileSync('api/lib/brandSvgs.js', `// GENERATED from src/components/icons/CategoryIcon.jsx by
// UPDATE_BRAND_SVGS=1 npx vitest run tests/unit/api/brandSvgs.test.jsx
export const CATEGORY_SVGS = ${JSON.stringify(current, null, 2)}\n`)
      return
    }
    expect(CATEGORY_SVGS).toEqual(current)
  })
})
