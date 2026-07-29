#!/usr/bin/env bash
# `concertino doctor` must name the usual CAUSE of the rendered-artifact
# drift doctor-artifacts.test.sh already covers: local <base> falling behind
# its remote — usually because Phase 4 cleanup's fast-forward (CON-25) didn't
# run. A sibling to doctor-artifacts.test.sh, exercising the new `Git`
# section instead of `Rendered artifacts`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { grep -qF "$2" "$3" && ok "$1" || bad "$1" "expected to find [$2]"; }
hasnt(){ grep -qF "$2" "$3" && bad "$1" "unexpectedly found [$2]" || ok "$1"; }

echo "concertino doctor (local base branch behind remote)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REMOTE="$WORK/remote.git"
PRIMARY="$WORK/primary"

git init -q --bare "$REMOTE"
git clone -q "$REMOTE" "$PRIMARY" 2>/dev/null
node "$ROOT/bin/concertino" sync --out="$PRIMARY" --config="$ROOT/config/examples/generic.json" > "$WORK/sync.txt" 2>&1
if [ $? -ne 0 ]; then
  echo "  FAIL sync into the throwaway project"
  tail -5 "$WORK/sync.txt"
  exit 1
fi
cp "$ROOT/config/examples/generic.json" "$PRIMARY/concertino.config.json"
git -C "$PRIMARY" add -A
git -C "$PRIMARY" -c user.email=t@t.com -c user.name=t commit -q -m init
git -C "$PRIMARY" branch -M main
git -C "$PRIMARY" push -q origin main

# --- freshly current: no warning --------------------------------------------
OUT="$WORK/doctor.txt"
node "$ROOT/bin/concertino" doctor --out="$PRIMARY" > "$OUT" 2>&1
has   "reports the Git section"           "Git"                    "$OUT"
hasnt "a current base branch is not nagged" "commits behind"        "$OUT"

# --- a merge lands on the remote, outside the workflow ----------------------
OTHER="$(mktemp -d)"
git clone -q "$REMOTE" "$OTHER" 2>/dev/null
git -C "$OTHER" checkout -q main
git -C "$OTHER" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "merged PR 1"
git -C "$OTHER" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "merged PR 2"
git -C "$OTHER" push -q origin main
rm -rf "$OTHER"

node "$ROOT/bin/concertino" doctor --out="$PRIMARY" > "$OUT" 2>&1
has "names the commit count"              "2 commits behind"                   "$OUT"
has "names Phase 4 cleanup's fast-forward as the usual cause" "fast-forward"    "$OUT"
has "tells the user how to fix it"        "run \`concertino sync\`"            "$OUT"
# A warning, never a hard failure — matches doctor-artifacts.test.sh's own
# assertion for the drift check this names the cause of.
hasnt "staleness is a warning, not an error" "action required"                 "$OUT"

# --- fast-forwarding clears the warning -------------------------------------
git -C "$PRIMARY" fetch -q origin main
git -C "$PRIMARY" merge -q --ff-only origin/main
node "$ROOT/bin/concertino" doctor --out="$PRIMARY" > "$OUT" 2>&1
hasnt "fast-forwarding clears the warning" "commits behind" "$OUT"

# --- being ahead of origin (unpushed local commits) is not this check's concern --
git -C "$PRIMARY" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "local, unpushed"
node "$ROOT/bin/concertino" doctor --out="$PRIMARY" > "$OUT" 2>&1
hasnt "being ahead of origin is not flagged" "commits behind" "$OUT"

# --- offline (no such remote) degrades silently, doctor keeps running -------
git -C "$PRIMARY" remote remove origin
node "$ROOT/bin/concertino" doctor --out="$PRIMARY" > "$OUT" 2>&1
hasnt "an unreachable remote raises no error for this check" "commits behind" "$OUT"
has   "doctor still runs its other checks when the fetch fails" "Rendered artifacts" "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
