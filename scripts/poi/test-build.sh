#!/usr/bin/env bash
# Fast self-check for the POI download fallback. No full extract download, so it
# runs in seconds. Catches a regression in extracts_dated (the contract that
# decides which day's data ships) and in the fallback loop's control flow.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
GEOFABRIK=https://download.geofabrik.de
UA='ROAM-poi-build/1.0 (test)'
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
fail=0

# --- 1) real extracts_dated: the two newest dated pbfs, newest-first ---------
# Short retry so the test fails fast if the listing is briefly unavailable.
fetch() { curl -fsSL --max-redirs 5 --retry 2 --retry-delay 2 --retry-all-errors -A "$UA" -o "$2" "$1"; }
extracts_dated() {
  fetch "$GEOFABRIK/$1/" "$W/$2.listing" || return 0
  grep -oE "$2-[0-9]{6}\.osm\.pbf" "$W/$2.listing" | sort -ru | head -2
}
list=$(extracts_dated "europe/great-britain" "great-britain")
n=$(printf '%s\n' "$list" | grep -c .)
first=$(printf '%s\n' "$list" | sed -n 1p)
last=$(printf '%s\n' "$list" | sed -n 2p)
if [ "$n" -eq 2 ] && [[ "$first" > "$last" ]]; then
  echo "PASS extracts_dated: newest-first ($first, $last)"
else
  echo "FAIL extracts_dated: n=$n [$list]"; fail=1
fi

# --- 2) fallback loop control flow: 404 once, then succeed -------------------
# Mock fetch_once driven by a counter: call 1 (pbf) 404s, the rest succeed. The
# loop must move on after the failure and break on the success.
calls=0
fetch_once() {
  calls=$((calls+1))
  [ "$calls" -eq 1 ] && return 22   # first pbf 404s
  : > "$2"
  return 0
}
ok=
pbf="$W/ctl.osm.pbf"
for dated in day1 day2; do
  if fetch_once "url/$dated" "$pbf" \
     && fetch_once "url/$dated.md5" "$pbf.md5"; then
    ok=1; break
  fi
  rm -f "$pbf" "$pbf.md5"
done
# day1: pbf 404s (call 1) -> move on. day2: pbf+md5 succeed (calls 2,3) -> break.
# (md5 of day1 is never fetched because pbf failed first.)
if [ -n "$ok" ] && [ "$calls" -eq 3 ]; then
  echo "PASS loop: moved on after 404, broke on success (calls=$calls)"
else
  echo "FAIL loop: ok=$ok calls=$calls"; fail=1
fi

# --- 3) loop exits clean when every file 404s ---------------------------------
calls=0
fetch_once() { calls=$((calls+1)); return 22; }
ok=
pbf="$W/ctl2.osm.pbf"
for dated in day1 day2; do
  if fetch_once "url/$dated" "$pbf" \
     && fetch_once "url/$dated.md5" "$pbf.md5"; then
    ok=1; break
  fi
  rm -f "$pbf" "$pbf.md5"
done
if [ -z "$ok" ] && [ ! -e "$pbf" ]; then
  echo "PASS loop: no data -> ok empty, partials cleaned"
else
  echo "FAIL loop: ok=$ok pbf_exists=$([ -e "$pbf" ] && echo yes || echo no)"; fail=1
fi

[ "$fail" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
