// @vitest-environment node
// Regression: Geofabrik dropped the "latest" symlinks for .md5 and .poly
// (Nov 2026), so `build.sh`'s download URLs 404 and the nightly POI build
// fails. The fix resolves the newest dated pbf from the directory listing and
// fetches the pbf, its .md5 and the .poly from the dated subdirectory.
//
// This test exercises the `newest_extract` pipeline (grep/sort/tail) against
// a sample directory listing — no network, no osmium-tool.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const buildSh = readFileSync(new URL('../../../scripts/poi/build.sh', import.meta.url), 'utf8')

// The newest_extract pipeline, parameterised: given a directory listing and
// a base name, pick the newest dated pbf.
const pickNewest = (listing, name) => {
  const r = spawnSync('bash', ['-e', '-c', `printf '%s' "$1" | grep -oE "$2-[0-9]{6}\\.osm\\.pbf" | sort | tail -1`, 'x', listing, name], {
    encoding: 'utf8',
  })
  return r.stdout.trim()
}

describe('build.sh newest_extract pipeline', () => {
  it('picks the newest dated pbf from a directory listing', () => {
    const listing = [
      '<a href="great-britain-261101.osm.pbf">old</a>',
      '<a href="great-britain-261115.osm.pbf">mid</a>',
      '<a href="great-britain-261119.osm.pbf">new</a>',
      '<a href="great-britain-latest.osm.pbf">latest</a>',
    ].join('\n')
    expect(pickNewest(listing, 'great-britain')).toBe('great-britain-261119.osm.pbf')
  })

  it('handles a single dated file', () => {
    const listing = '<a href="rutland-261119.osm.pbf">only</a>'
    expect(pickNewest(listing, 'rutland')).toBe('rutland-261119.osm.pbf')
  })

  it('returns empty when no dated file matches', () => {
    const listing = '<a href="other-261119.osm.pbf">no</a>'
    expect(pickNewest(listing, 'great-britain')).toBe('')
  })

  it('does not match the "latest" pseudo-file', () => {
    const listing = '<a href="great-britain-latest.osm.pbf">only</a>'
    expect(pickNewest(listing, 'great-britain')).toBe('')
  })

  it('sorts by date, not alphabetically (261119 > 261109)', () => {
    const listing = [
      '<a href="great-britain-261109.osm.pbf">a</a>',
      '<a href="great-britain-261119.osm.pbf">b</a>',
    ].join('\n')
    expect(pickNewest(listing, 'great-britain')).toBe('great-britain-261119.osm.pbf')
  })
})

describe('build.sh source hardening', () => {
  it('resolves the dated pbf before fetching (no bare "latest" .md5/.poly URLs)', () => {
    // The old, broken URLs must be gone from the download path.
    expect(buildSh).not.toMatch(/fetch "\$GEOFABRIK\/\$ex-latest\.osm\.pbf\.md5"/)
    expect(buildSh).not.toMatch(/fetch "\$GEOFABRIK\/\$ex\.poly"/)
    // The new logic: resolve the dated pbf, then fetch from the subdirectory.
    expect(buildSh).toMatch(/newest_extract/)
    expect(buildSh).toMatch(/fetch "\$GEOFABRIK\/\$ex\/\$dated"/)
    expect(buildSh).toMatch(/fetch "\$GEOFABRIK\/\$ex\/\$dated\.md5"/)
    expect(buildSh).toMatch(/fetch "\$GEOFABRIK\/\$ex\/\$name\.poly"/)
  })

  it('fails loudly when the dated pbf cannot be resolved', () => {
    expect(buildSh).toMatch(/\[ -n "\$dated" \] \|\| \{ echo "could not resolve \$ex" >&2; exit 1; \}/)
  })
})
