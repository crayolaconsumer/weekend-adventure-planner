#!/usr/bin/env bash
# POI build runbook: Geofabrik extracts -> chunks + manifest.json + coverage.json
# in $WORK/out. The nightly workflow (.github/workflows/poi-build.yml) runs this
# same script, then publishes and loads. Run it by hand when Actions is down:
#
#   scripts/poi/build.sh                          # GB + NI/Ireland, full gates
#   gh release create "poi-$(jq -r .build_id /tmp/roam-poi/out/manifest.json)" /tmp/roam-poi/out/* \
#     --notes "© OpenStreetMap contributors, ODbL 1.0"
#   node scripts/poi/load.mjs --build <build_id>
#
# Small local test (Rutland, ~2 MB, gates relaxed):
#   EXTRACTS=europe/united-kingdom/england/rutland MIN_ROWS=0 MIN_SENTINEL_RATIO=0 scripts/poi/build.sh
#
# Needs osmium-tool (brew install osmium-tool / apt-get install osmium-tool) and node.
# Env: WORK (default /tmp/roam-poi), EXTRACTS, REGION (uk), PREV_MANIFEST,
# MIN_ROWS, MIN_SENTINEL_RATIO, REUSE=1 (keep already-downloaded extracts).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=${WORK:-/tmp/roam-poi}
EXTRACTS=${EXTRACTS:-"europe/great-britain europe/ireland-and-northern-ireland"}
REGION=${REGION:-uk}
GEOFABRIK=https://download.geofabrik.de
UA='ROAM-poi-build/1.0 (https://www.go-roam.uk; support@extrastaff.com)'

fetch() { curl -fsSL --retry 3 --retry-all-errors -A "$UA" -o "$2" "$1"; }
md5of() { (md5sum "$1" 2>/dev/null || md5 -r "$1") | cut -d' ' -f1; }

mkdir -p "$WORK/out"
rm -f "$WORK"/out/*
node "$ROOT/scripts/poi/filter.mjs" > "$WORK/filter.txt"
sed 's#^nwr/#r/#' "$WORK/filter.txt" > "$WORK/filter-rel.txt"

args=()
stamps=()
for ex in $EXTRACTS; do
  name=$(basename "$ex")
  pbf="$WORK/$name-latest.osm.pbf"
  if [ "${REUSE:-0}" != 1 ] || [ ! -s "$pbf" ]; then
    echo "Downloading $ex"
    fetch "$GEOFABRIK/$ex-latest.osm.pbf" "$pbf"
    fetch "$GEOFABRIK/$ex-latest.osm.pbf.md5" "$pbf.md5"
    fetch "$GEOFABRIK/$ex.poly" "$WORK/$name.poly"
  fi
  if [ "$(cut -d' ' -f1 "$pbf.md5")" != "$(md5of "$pbf")" ]; then
    echo "md5 mismatch for $pbf" >&2
    exit 1
  fi
  stamps+=("$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$pbf")")

  echo "Filtering $name"
  osmium tags-filter "$pbf" -e "$WORK/filter.txt" -O -o "$WORK/$name-pois.osm.pbf"
  osmium export "$WORK/$name-pois.osm.pbf" -f geojsonseq --add-unique-id=type_id -O -o "$WORK/$name.geojsonseq"
  # Relations osmium can't build as areas (type=site, untyped): member geometry for their centre
  osmium tags-filter "$WORK/$name-pois.osm.pbf" -e "$WORK/filter-rel.txt" -O -o "$WORK/$name-rels.osm.pbf"
  osmium add-locations-to-ways "$WORK/$name-rels.osm.pbf" --keep-member-nodes --ignore-missing-nodes -f opl -O -o "$WORK/$name-rels.opl"
  args+=(--in "$WORK/$name.geojsonseq" --relations "$WORK/$name-rels.opl" --poly "$WORK/$name.poly")
done

# Build id + osm_timestamp from the NEWEST extract: a new day's GB data must
# get a new build id even if the Ireland extract hasn't updated yet
osm_ts=$(printf '%s\n' "${stamps[@]}" | sort | tail -1)
[ -n "${PREV_MANIFEST:-}" ] && [ -s "$PREV_MANIFEST" ] && args+=(--prev-manifest "$PREV_MANIFEST")
[ -n "${MIN_ROWS:-}" ] && args+=(--min-rows "$MIN_ROWS")
[ -n "${MIN_SENTINEL_RATIO:-}" ] && args+=(--min-sentinel-ratio "$MIN_SENTINEL_RATIO")

node "$ROOT/scripts/poi/build.mjs" "${args[@]}" --osm-timestamp "$osm_ts" --region "$REGION" --out "$WORK/out"
ls -l "$WORK/out"
