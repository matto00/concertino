#!/usr/bin/env bash
# `concertino doctor` must notice when a project's rendered artifacts have
# drifted from core. This is the failure that cost a first user an hour: their
# scripts/concertino/*.sh had been reverted by a local edit and their gitignored
# .claude/agents/concertino-*.md predated the core they were rendered from, so
# nothing emitted telemetry and the dashboard showed an empty screen. Doctor was
# entirely silent about all of it.
#
# Doctor's own exit code is not asserted: it also checks the environment (gh
# auth, the claude CLI), which is not what this test is about. The artifact
# lines are.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { grep -qF "$2" "$3" && ok "$1" || bad "$1" "expected to find [$2]"; }
hasnt(){ grep -qF "$2" "$3" && bad "$1" "unexpectedly found [$2]" || ok "$1"; }

echo "concertino doctor (rendered artifacts)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/doctor.txt"

# A throwaway project, synced from the example config, then given a config of
# its own so doctor reads it without --config.
node "$ROOT/bin/concertino" sync --out="$WORK" --config="$ROOT/config/examples/generic.json" > "$WORK/sync.txt" 2>&1
if [ $? -ne 0 ]; then
  echo "  FAIL sync into the throwaway project"
  tail -5 "$WORK/sync.txt"
  exit 1
fi
cp "$ROOT/config/examples/generic.json" "$WORK/concertino.config.json"

# --- freshly synced: everything matches -------------------------------------
node "$ROOT/bin/concertino" doctor --out="$WORK" > "$OUT" 2>&1
has   "reports the artifacts section"      "Rendered artifacts" "$OUT"
has   "copied assets match core"           "files match core"   "$OUT"
has   "agent files are present"            "agent files"        "$OUT"
hasnt "a healthy project is not nagged"    "concertino sync"    "$OUT"

# --- now break it two different ways ----------------------------------------
# One file deleted outright, one edited in place. These are different user
# problems and must not be reported as the same thing.
rm -f "$WORK/scripts/concertino/cleanup.sh"
printf '\n# local edit that never went back upstream\n' >> "$WORK/scripts/concertino/emit-event.sh"
rm -f "$WORK/.claude/agents/concertino-skeptic.md"

node "$ROOT/bin/concertino" doctor --out="$WORK" > "$OUT" 2>&1
has "names the deleted script as missing"  "missing: scripts/concertino/cleanup.sh"      "$OUT"
has "names the edited script as differing" "differs from core: scripts/concertino/emit-event.sh" "$OUT"
has "names the unrendered agent file"      ".claude/agents/concertino-skeptic.md"        "$OUT"
has "tells the user how to fix it"         "run \`concertino sync\`"                     "$OUT"
# A warning, never a hard failure: drift is recoverable and doctor must still
# report the rest of the environment.
hasnt "drift is a warning, not an error"   "action required"                             "$OUT"

# --- and that `sync` is genuinely the fix -----------------------------------
node "$ROOT/bin/concertino" sync --out="$WORK" > /dev/null 2>&1
node "$ROOT/bin/concertino" doctor --out="$WORK" > "$OUT" 2>&1
hasnt "sync clears the warnings" "concertino sync" "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
