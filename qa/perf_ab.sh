#!/bin/zsh
# Interleaved before/after measurement (the machine's load drifts over minutes, so each profile is measured for both
# versions back to back). BEFORE = a copy of the site with the old main.js + old GLB served on another port.
#   zsh qa/perf_ab.sh http://localhost:8793/ http://localhost:8770/
cd "$(dirname "$0")/.."
B=${1:-http://localhost:8793/}; A=${2:-http://localhost:8770/}
rm -f qa/perf_before.json qa/perf_after.json
for p in desktop laptop-4x phone-4x; do
  for run in "before $B" "after $A"; do
    set -- ${=run}
    echo "== $1 $p"
    PERF_MERGE=1 PERF_ONLY=$p PERF_NOGLB=1 node qa/perf.cjs $1 $2 | grep -v '^GLB\|^errors (none)'
  done
done
for run in "before $B" "after $A"; do set -- ${=run}; PERF_MERGE=1 PERF_ONLY=none node qa/perf.cjs $1 $2 | grep '^GLB'; done
