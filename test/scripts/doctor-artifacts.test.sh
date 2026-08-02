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

# Create a throwaway copy of the project for testing resolveCore() — ensures
# tests don't mutate the real repository or leave dangling git worktree entries.
# CON-57: bin/concertino now requires lib/config.js (shared with the
# settings screen) unconditionally at the top of the file, for every
# command — so this copy has to include lib/ too, exactly like a real
# `npm install` would (package.json's own "files" array already lists both
# bin/ and lib/); omitting it here is not a smaller/faster fixture, it is an
# incomplete one that happened to work only while every command this test
# exercises was still self-contained inside bin/concertino itself.
new_main() {
  local d; d="$(mktemp -d)"
  cp -r "$ROOT/bin" "$d/bin"
  cp -r "$ROOT/lib" "$d/lib"
  cp -r "$ROOT/adapters" "$d/adapters"
  cp -r "$ROOT/core" "$d/core"
  cp -r "$ROOT/config" "$d/config"
  cp "$ROOT/package.json" "$d/package.json"
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t.test -c user.name=t add -A
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q -m init
  printf '%s' "$d"
}

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

# --- diverged core/roles/* is also detected (CON-36) --------------------------
# Test the resolveCore()/coresDiffer() path: a project in a worktree whose
# core/roles/ has diverged must produce "differs from the executing script"
# divergence note. Uses throwaway copy to ensure clean isolation, following
# the pattern in sync-core-resolution.test.sh.
MAIN="$(new_main)"
trap 'rm -rf "$WORK" "$MAIN"' EXIT
git -C "$MAIN" worktree add -q "$MAIN/wt" -b feat-roles || { bad "CON-36 worktree setup"; exit 1; }
WT="$MAIN/wt"

# Only divergence: modify the role file. Keep scripts/laws/workflow-state.md
# byte-identical to ensure the assertion is specific to roles.
printf '\nWORKTREE-ROLE-DIVERGENCE-MARKER\n' >> "$WT/core/roles/executor.md"

# Sync a project inside the worktree
cp "$MAIN/config/examples/generic.json" "$WT/concertino.config.json"
node "$MAIN/bin/concertino" sync --out="$WT" > /dev/null 2>&1

# Run doctor and verify it detects the divergence via the specific string
node "$MAIN/bin/concertino" doctor --out="$WT" > "$OUT" 2>&1
has   "CON-36 detects diverged roles file"        "differs from the executing script" "$OUT"
has   "CON-36 note names the worktree's core"     "$WT/core" "$OUT"
has   "CON-36 note names the main core"           "$MAIN/core" "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
