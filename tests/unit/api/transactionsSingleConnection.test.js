import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The pool allows ONE connection per instance (api/lib/db.js). A transaction
// holds it, so any pool helper called inside a transaction callback would
// wait forever for that same connection. Everything inside must use `conn`.
const POOL_CALL = /(?<![\w.])(query|queryOne|queryAll|insert|update|execute|remove)\(/

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []
  })
}

function transactionBodies(src) {
  const out = []
  const re = /transaction\(\s*async\s*\(?\s*\w*\s*\)?\s*=>\s*\{/g
  let _m
  while ((_m = re.exec(src))) {
    let i = re.lastIndex, depth = 1
    while (depth && i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++ }
    out.push(src.slice(re.lastIndex, i))
  }
  return out
}

describe('transactions never borrow a second connection', () => {
  it('no pool helper is called inside any transaction callback', () => {
    const offenders = []
    for (const f of files('api')) {
      if (f.endsWith('lib/db.js')) continue
      transactionBodies(readFileSync(f, 'utf8')).forEach(b => { if (POOL_CALL.test(b)) offenders.push(f) })
    }
    expect(offenders).toEqual([])
  })

  it('the checker catches a pool call inside a transaction', () => {
    const bad = 'await transaction(async (conn) => { await queryOne("SELECT 1") })'
    expect(transactionBodies(bad).some(b => POOL_CALL.test(b))).toBe(true)
  })
})
