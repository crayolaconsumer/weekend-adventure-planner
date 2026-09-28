// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'

const yml = readFileSync(new URL('../../../.github/workflows/poi-build.yml', import.meta.url), 'utf8')

// Steps as text blocks (no YAML dependency in the repo); the run: scripts are
// executed for real below, against fake curl and gh on PATH.
const steps = yml.split(/\n {6}- /).slice(1)
const step = name => steps.find(s => s.startsWith(`name: ${name}`))
const runScript = block => {
  const lines = block.split('\n')
  const at = lines.findIndex(l => /^ {8}run: \|$/.test(l))
  return lines.slice(at + 1).filter(l => l.startsWith('          ') || l === '').map(l => l.slice(10)).join('\n')
}

describe('poi-build.yml static hardening', () => {
  it('pins every action to a full commit SHA', () => {
    const uses = [...yml.matchAll(/uses: (\S+)/g)].map(m => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/)
  })

  it('checkout does not persist the token, and permissions are contents: write only', () => {
    expect(yml).toMatch(/persist-credentials: false/)
    expect(yml).toMatch(/\npermissions:\n {2}contents: write\n\n/)
  })

  it('secrets are step-scoped, never job-wide', () => {
    const jobEnv = yml.slice(yml.indexOf('    env:'), yml.indexOf('    steps:'))
    expect(jobEnv).not.toMatch(/GH_TOKEN|SECRET/)
    const withSecret = steps.filter(s => s.includes('secrets.POI_LOAD_SECRET')).map(s => s.split('\n')[0])
    expect(withSecret).toEqual(['name: Previous manifest (per-key drift gate)', 'name: Load into the database', 'name: Prune releases (keep the newest 7 builds)'])
    for (const s of steps.filter(s => s.includes('GH_TOKEN'))) expect(s).toMatch(/gh release/)
  })

  it('prunes only after this run went live', () => {
    expect(step('Prune releases (keep the newest 7 builds)')).toMatch(/if: \$\{\{ steps\.load\.outputs\.active == 'true' \}\}/)
  })
})

// ─── Fakes ──────────────────────────────────────────────────────────
// curl: each call takes the next line of $FAKE_DIR/responses:
//   "<http code> <body>"  -> body to -o file, code on stdout, exit 0
//   "EXIT <n>"            -> prints 000 (as real curl does) and exits n
const FAKE_CURL = `#!/bin/bash
out=; url=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift;; http*) url=$1;; esac; shift; done
echo "$url" >> "$FAKE_DIR/calls"
n=$(grep -c . "$FAKE_DIR/calls")
line=$(sed -n "\${n}p" "$FAKE_DIR/responses")
if [ "\${line%% *}" = EXIT ]; then printf 000; exit "\${line#* }"; fi
printf '%s' "\${line#* }" > "$out"
printf '%s' "\${line%% *}"
`
// gh: logs every call; answers from FAKE_* env vars / files
const FAKE_GH = `#!/bin/bash
echo "$*" >> "$FAKE_DIR/gh.log"
case "$1 $2" in
  "release view")
    case "$*" in
      *isDraft*) [ "$FAKE_DRAFT" = none ] && exit 1; echo "$FAKE_DRAFT" ;;
      *assets*) echo "$FAKE_ASSETS" ;;
    esac ;;
  "release download")
    [ -n "$FAKE_DL_FAIL" ] && exit 1
    while [ $# -gt 0 ]; do
      [ "$1" = --output ] && cp "$FAKE_DIR/published.json" "$2"
      [ "$1" = --dir ] && [ -d "$FAKE_DIR/prev-photos" ] && cp "$FAKE_DIR"/prev-photos/* "$2"/
      shift
    done ;;
  "release list") echo "$FAKE_NEWEST" ;;
esac
exit 0
`

describe('workflow steps (run for real against fake curl + gh)', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'poi-wf-'))
    writeFileSync(join(dir, 'curl'), FAKE_CURL)
    writeFileSync(join(dir, 'gh'), FAKE_GH)
    chmodSync(join(dir, 'curl'), 0o755)
    chmodSync(join(dir, 'gh'), 0o755)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const exec = (name, env = {}, responses = []) => {
    writeFileSync(join(dir, 'responses'), responses.join('\n') + '\n')
    for (const f of ['calls', 'out', 'env', 'gh.log']) writeFileSync(join(dir, f), '')
    const r = spawnSync('bash', ['-e', '-c', runScript(step(name))], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`, FAKE_DIR: dir, RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, 'out'), GITHUB_ENV: join(dir, 'env'),
        WORK: join(dir, 'work'), ...env,
      },
    })
    const read = f => readFileSync(join(dir, f), 'utf8')
    return {
      code: r.status,
      calls: read('calls').trim().split('\n').filter(Boolean).map(u => u.split('?')[1].split('&').filter(p => !p.startsWith('build=')).join('&')),
      gh: read('gh.log').trim().split('\n').filter(Boolean),
      out: read('out'),
      env: read('env'),
      all: r.stdout + r.stderr,
    }
  }

  describe('Load into the database', () => {
    const load = env => exec('Load into the database', { POI_LOAD_SECRET: 's3cret-value', BUILD_ID: 'uk-20260926T2022Z', ...env })

    it('fails (not skips) when a load is requested but POI_LOAD_SECRET is missing', () => {
      const r = load({ POI_LOAD_SECRET: '' })
      expect(r.code).not.toBe(0)
      expect(r.calls).toEqual([])
      expect(r.all).toMatch(/load=false to publish only/)
    })

    it('only runs when load is requested (load=false publishes only), via load.mjs', () => {
      expect(step('Load into the database')).toMatch(/if: \$\{\{ inputs\.load \}\}/)
      expect(runScript(step('Load into the database'))).toMatch(/node scripts\/poi\/load\.mjs --build "\$BUILD_ID" && echo active=true >> "\$GITHUB_OUTPUT"/)
    })
  })

  describe('Publish release', () => {
    const manifest = hashes => JSON.stringify({ build_id: 'uk-20260926T2022Z', chunks: hashes.map((h, i) => ({ name: `chunk-00${i}.ndjson.gz`, sha256: h, rows: 1 })) })
    const publish = (env, local = ['aa', 'bb'], published = null) => {
      mkdirSync(join(dir, 'work', 'out'), { recursive: true })
      writeFileSync(join(dir, 'work', 'out', 'manifest.json'), manifest(local))
      if (published) writeFileSync(join(dir, 'published.json'), manifest(published))
      return exec('Publish release', { FAKE_ASSETS: '4', ...env })
    }

    it('new build: draft, upload, count assets, then publish', () => {
      const r = publish({ FAKE_DRAFT: 'none' })
      expect(r.code).toBe(0)
      expect(r.gh.map(c => c.split(' ').slice(0, 2).join(' '))).toEqual(['release view', 'release create', 'release upload', 'release view', 'release edit'])
      expect(r.gh[1]).toMatch(/--draft/)
      expect(r.gh[4]).toMatch(/--draft=false/)
      expect(r.out).toBe('build_id=uk-20260926T2022Z\n')
    })

    it('uploads the photo files when present and counts them', () => {
      mkdirSync(join(dir, 'work', 'out'), { recursive: true })
      for (const f of ['photos.ndjson.gz', 'photo-misses.json.gz']) writeFileSync(join(dir, 'work', 'out', f), 'x')
      expect(publish({ FAKE_DRAFT: 'none', FAKE_ASSETS: '5' }).code).not.toBe(0)
      const r = publish({ FAKE_DRAFT: 'none', FAKE_ASSETS: '6' })
      expect(r.code).toBe(0)
      expect(r.gh.find(c => c.startsWith('release upload'))).toMatch(/photos\.ndjson\.gz .*photo-misses\.json\.gz$/)
    })

    it('asset count short: stays a draft, job fails', () => {
      const r = publish({ FAKE_DRAFT: 'none', FAKE_ASSETS: '3' })
      expect(r.code).not.toBe(0)
      expect(r.gh.some(c => c.includes('--draft=false'))).toBe(false)
    })

    it('leftover draft is deleted without --cleanup-tag (a draft has no tag), then recreated', () => {
      const r = publish({ FAKE_DRAFT: 'true' })
      expect(r.code).toBe(0)
      const del = r.gh.find(c => c.startsWith('release delete'))
      expect(del).toBe('release delete poi-uk-20260926T2022Z --yes')
      expect(r.gh.indexOf(del)).toBeLessThan(r.gh.findIndex(c => c.startsWith('release create')))
    })

    it('already published with identical chunks: uploads nothing', () => {
      const r = publish({ FAKE_DRAFT: 'false' }, ['aa', 'bb'], ['aa', 'bb'])
      expect(r.code).toBe(0)
      expect(r.out).toBe('build_id=uk-20260926T2022Z\n')
      expect(r.gh.some(c => /release (create|upload|edit|delete)/.test(c))).toBe(false)
    })

    it('already published with different chunks: fails loudly', () => {
      const r = publish({ FAKE_DRAFT: 'false' }, ['aa', 'bb'], ['aa', 'cc', 'dd'])
      expect(r.code).not.toBe(0)
      expect(r.all).toMatch(/refusing to load a mix/)
    })
  })

  describe('Photos', () => {
    // A fake node standing in for photos.mjs: FAKE_PHOTOS=ok writes its outputs, else fails
    const FAKE_NODE = `#!/bin/bash
[ "$FAKE_PHOTOS" = ok ] || exit 1
while [ $# -gt 0 ]; do [ "$1" = --out ] && out=$2; shift; done
printf 'new' | gzip > "$out/photos.ndjson.gz"
echo '{"photo_count":7,"photos_sha256":"${'a'.repeat(64)}","requests":9}' > "$out/photos-manifest.json"
`
    const photos = (env, prev = false) => {
      writeFileSync(join(dir, 'node'), FAKE_NODE)
      writeFileSync(join(dir, 'timeout'), '#!/bin/bash\nshift\nexec "$@"\n')
      writeFileSync(join(dir, 'sleep'), '#!/bin/bash\necho "sleep $*" >> "$FAKE_DIR/gh.log"\n')
      chmodSync(join(dir, 'sleep'), 0o755)
      chmodSync(join(dir, 'node'), 0o755)
      chmodSync(join(dir, 'timeout'), 0o755)
      mkdirSync(join(dir, 'work', 'out'), { recursive: true })
      writeFileSync(join(dir, 'work', 'out', 'manifest.json'), JSON.stringify({ build_id: 'uk-20260926T2022Z', photo_count: 0 }))
      let sha = null
      if (prev) {
        mkdirSync(join(dir, 'prev-photos'), { recursive: true })
        spawnSync('bash', ['-c', `printf '{"a":1}\n{"a":2}\n' | gzip > "${dir}/prev-photos/photos.ndjson.gz"; echo '[]' | gzip > "${dir}/prev-photos/photo-misses.json.gz"`])
        sha = createHash('sha256').update(readFileSync(join(dir, 'prev-photos', 'photos.ndjson.gz'))).digest('hex')
      }
      writeFileSync(join(dir, 'work', 'prev-manifest.json'), JSON.stringify({ photos_sha256: prev === 'corrupt' ? 'b'.repeat(64) : sha }))
      const r = exec('Photos', { PREV_TAG: 'poi-uk-20260925T0215Z', FAKE_ASSETS: prev ? 'true' : 'false', ...env })
      return { ...r, manifest: JSON.parse(readFileSync(join(dir, 'work', 'out', 'manifest.json'), 'utf8')), has: f => existsSync(join(dir, 'work', 'out', f)) }
    }

    it('merges the photo count and sha into the manifest, from yesterday\'s photos', () => {
      const r = photos({ FAKE_PHOTOS: 'ok' }, true)
      expect(r.code).toBe(0)
      expect(r.gh[0]).toBe(`release download poi-uk-20260925T0215Z --pattern photos.ndjson.gz --pattern photo-misses.json.gz --dir ${dir}/work/prev-photos --clobber`)
      expect(r.manifest).toEqual({ build_id: 'uk-20260926T2022Z', photo_count: 7, photos_sha256: 'a'.repeat(64) })
    })

    it('lookup failed: ships yesterday\'s photos unchanged, with their real count and sha', () => {
      const r = photos({ FAKE_PHOTOS: 'fail' }, true)
      expect(r.code).toBe(0)
      expect(r.all).toMatch(/shipping the previous photos unchanged/)
      const sha = createHash('sha256').update(readFileSync(join(dir, 'prev-photos', 'photos.ndjson.gz'))).digest('hex')
      expect(r.manifest).toMatchObject({ photo_count: 2, photos_sha256: sha })
      expect(r.has('photo-misses.json.gz')).toBe(true)
    })

    it('yesterday shipped photos but the download fails: the run stops (never a silent cold start)', () => {
      const r = photos({ FAKE_PHOTOS: 'ok', FAKE_DL_FAIL: '1' }, true)
      expect(r.code).not.toBe(0)
      expect(r.gh.filter(c => c.startsWith('release download'))).toHaveLength(3) // retried twice first
      expect(r.gh.filter(c => c.startsWith('sleep'))).toEqual(['sleep 20', 'sleep 40'])
      expect(r.has('photos.ndjson.gz')).toBe(false)
    })

    it('previous photos that don\'t match their manifest stop the run before any lookup', () => {
      const r = photos({ FAKE_PHOTOS: 'ok' }, 'corrupt')
      expect(r.code).not.toBe(0)
      expect(r.all).toMatch(/does not match its manifest/)
      expect(r.has('photos.ndjson.gz')).toBe(false)
    })

    it('lookup failed and no previous photos: ships none, manifest untouched', () => {
      const r = photos({ FAKE_PHOTOS: 'fail' })
      expect(r.code).toBe(0)
      expect(r.gh.some(c => c.startsWith('release download'))).toBe(false)
      expect(r.has('photos.ndjson.gz')).toBe(false)
      expect(r.manifest).toEqual({ build_id: 'uk-20260926T2022Z', photo_count: 0 })
    })
  })

  describe('Prune releases', () => {
    // FAKE_NEWEST = what gh's --jq returns: the releases older than the newest 7
    const old = ['poi-uk-20260901T0000Z', 'poi-uk-20260902T0000Z', 'poi-uk-20260903T0000Z', 'poi-uk-20260904T0000Z'].join('\n')
    const prune = responses => exec('Prune releases (keep the newest 7 builds)', {
      POI_LOAD_SECRET: 's3cret-value', BUILD_ID: 'uk-20260927T0000Z', FAKE_NEWEST: old,
    }, responses)
    const deleted = r => r.gh.filter(c => c.startsWith('release delete')).map(c => c.split(' ')[2])

    it('never deletes the active or previous release, even when older than the newest 7 (after a rollback)', () => {
      const r = prune(['200 {"active_build_id":"uk-20260902T0000Z","active_release_tag":"poi-uk-20260902T0000Z","previous_release_tag":"poi-uk-20260903T0000Z","latest":{}}'])
      expect(r.code).toBe(0)
      expect(deleted(r)).toEqual(['poi-uk-20260901T0000Z', 'poi-uk-20260904T0000Z'])
      expect(r.gh.find(c => c.startsWith('release delete'))).toMatch(/--cleanup-tag --yes$/)
    })

    it('works without previous_release_tag (keeps active only)', () => {
      const r = prune(['200 {"active_build_id":"uk-20260902T0000Z","active_release_tag":"poi-uk-20260902T0000Z","latest":{}}'])
      expect(deleted(r)).toEqual(['poi-uk-20260901T0000Z', 'poi-uk-20260903T0000Z', 'poi-uk-20260904T0000Z'])
    })

    it('prunes nothing when status is unreachable, errors, or reports no valid active release', () => {
      for (const resp of ['EXIT 28', '500 {}', '401 {"error":"auth"}', '200 {"active_release_tag":null}', '200 {"active_release_tag":"poi-../x"}']) {
        const r = prune([resp])
        expect(r.code, resp).toBe(0)
        expect(deleted(r), resp).toEqual([])
        expect(r.all, resp).toMatch(/not pruning/)
      }
    })
  })

  describe('Previous manifest (drift baseline)', () => {
    const prev = (env, responses) => {
      writeFileSync(join(dir, 'published.json'), '{"per_key_counts":{}}')
      return exec('Previous manifest (per-key drift gate)', { POI_LOAD_SECRET: 's3cret-value', FAKE_NEWEST: 'poi-uk-20260927T0000Z', ...env }, responses)
    }

    it('uses the ACTIVE build reported by the loader status step', () => {
      const r = prev({}, ['200 {"active_build_id":"uk-20260920T2011Z","active_release_tag":"poi-uk-20260920T2011Z","latest":{}}'])
      expect(r.code).toBe(0)
      expect(r.calls).toEqual(['step=status'])
      expect(r.gh).toEqual([expect.stringMatching(/^release download poi-uk-20260920T2011Z /)])
      expect(existsSync(join(dir, 'work', 'prev-manifest.json'))).toBe(true)
      expect(r.all).toMatch(/Drift baseline: active release poi-uk-20260920T2011Z/)
      // The photos step starts from the same release's photos
      expect(r.env).toBe('PREV_TAG=poi-uk-20260920T2011Z\n')
    })

    it('falls back to the newest published release when status is unavailable or junk', () => {
      for (const resp of ['404 {"error":"no"}', 'EXIT 28', '200 {"active_release_tag":"../../etc"}', '200 {"active_build_id":null,"active_release_tag":null,"latest":null}', '200 {"active":"uk-20260920T2011Z"}']) {
        const r = prev({}, [resp])
        expect(r.code, resp).toBe(0)
        expect(r.gh.at(-1), resp).toMatch(/^release download poi-uk-20260927T0000Z /)
        expect(r.all, resp).toMatch(/Drift baseline: newest published release poi-uk-20260927T0000Z/)
      }
    })

    it('first build ever: no baseline, no failure', () => {
      const r = prev({ POI_LOAD_SECRET: '', FAKE_NEWEST: '' })
      expect(r.code).toBe(0)
      expect(r.calls).toEqual([])
      expect(r.gh.some(c => c.startsWith('release download'))).toBe(false)
    })
  })
})

// Regression: `${{ runner.temp }}` in job-level env made GitHub reject the
// workflow ("Unrecognized named-value: 'runner'"); the runner context only
// exists inside steps.
describe('poi-build workflow parses on GitHub', () => {
  it('uses no runner.* context outside steps', async () => {
    const src = (await import('node:fs')).readFileSync('.github/workflows/poi-build.yml', 'utf8')
    const beforeSteps = src.split(/^\s+steps:/m)[0]
    expect(beforeSteps).not.toMatch(/\$\{\{\s*runner\./)
  })
})
