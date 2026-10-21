#!/usr/bin/env bash
# The H2 host rigs (security §19d–§19h, rig 8) on Linux/WebKitGTK. Builds the
# host with the "rig" feature against the gate-1 corpus history, makes its own
# fixtures from the corpus, runs two multi-window scenarios, and asserts with
# check.py. A scenario that times out or reports nothing FAILS (§19f).
# Needs: a display (xvfb-run) and a D-Bus session; network for the embeds.
set -u
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/h2-rig}
rm -rf "$OUT"; mkdir -p "$OUT/fix"
BENTO_HISTORIES_DIR=../../fixtures/gate1 cargo build -q --features rig || exit 1
BIN=target/debug/bento-home-desktop
python3 - "$OUT/fix" <<'PY'
import sys, pathlib
out = pathlib.Path(sys.argv[1]); src = pathlib.Path('../../fixtures/gate1/served')
def make(name, fixture, doc_id):
    t = (src / fixture).read_text(encoding='utf-8')
    a = 'id="bento-doc">{'
    assert t.count(a) == 1, fixture
    (out / name).write_text(t.replace(a, a + f'"docId":"{doc_id}",'), encoding='utf-8')
make('A.bento.html', 'genuine-1.0.0.html', 'rig-a')         # genuine, pinned CSP
make('B.bento.html', 'genuine-1.2.0.html', 'rig-b')         # genuine, another release
make('U.bento.html', 'extra-plain-script.html', 'rig-u')    # unknown: no CSP
PY
procs() { # max WebKit web processes seen while the scenario runs
  local max=0 n; while kill -0 "$1" 2>/dev/null; do n=$(ps -eo comm | grep -c '^WebKitWebProces'); [ "$n" -gt "$max" ] && max=$n; sleep 0.5; done; echo "$max"
}
scenario() { # name timeout files...
  local name=$1 t=$2; shift 2
  local env=() n=0
  for f in "$@"; do env+=("BENTO_PROBE_doc$n=$OUT/$name-doc$n.json"); n=$((n+1)); done
  mkdir -p "$OUT/$name-data"
  env "${env[@]}" BENTO_DATA_DIR="$OUT/$name-data" timeout "$t" "$BIN" "$@" >/dev/null 2>"$OUT/$name.log" &
  local pid=$!
  procs "$pid" > "$OUT/$name.procs"
  wait "$pid"; local rc=$?; echo "$rc" > "$OUT/$name.exit"; echo "== $name exit $rc (web processes seen: $(cat "$OUT/$name.procs"))"
}
cp "$OUT/fix/A.bento.html" "$OUT/fix/U.bento.html" "$OUT/"; cp "$OUT/fix/B.bento.html" "$OUT/B.bento.html"
cp "$OUT/fix/U.bento.html" "$OUT/U2.bento.html"
scenario pair 120 "$OUT/A.bento.html" "$OUT/U.bento.html"
scenario tri 150 "$OUT/B.bento.html" "$OUT/U2.bento.html" "$OUT/B.bento.html"
python3 rig/check.py "$OUT"
