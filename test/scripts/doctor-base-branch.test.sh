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

# =============================================================================
# CON-32: a configured non-default project.baseRemote — doctor and cleanup.sh
# (via renderEnv's CONCERTINO_BASE_REMOTE) must resolve the same remote, not
# hardcode `origin`. Uses its own throwaway project so it doesn't disturb the
# remote-removal state PRIMARY is left in above.
# =============================================================================
write_config() {
  # $1 = target dir. Copies generic.json and sets project.baseRemote="upstream".
  node -e '
    const fs = require("fs");
    const base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    base.project.baseRemote = "upstream";
    fs.writeFileSync(process.argv[2], JSON.stringify(base, null, 2));
  ' "$ROOT/config/examples/generic.json" "$1/concertino.config.json"
}

REMOTE2="$WORK/remote2.git"
PRIMARY2="$WORK/primary2"
git init -q --bare "$REMOTE2"
git clone -q "$REMOTE2" "$PRIMARY2" 2>/dev/null
write_config "$PRIMARY2"

node "$ROOT/bin/concertino" sync --out="$PRIMARY2" --config="$PRIMARY2/concertino.config.json" > "$WORK/sync2.txt" 2>&1
if [ $? -ne 0 ]; then
  echo "  FAIL sync into the second throwaway project (configured baseRemote)"
  tail -5 "$WORK/sync2.txt"
  exit 1
fi

git -C "$PRIMARY2" add -A
git -C "$PRIMARY2" -c user.email=t@t.com -c user.name=t commit -q -m init
git -C "$PRIMARY2" branch -M main
git -C "$PRIMARY2" remote rename origin upstream
git -C "$PRIMARY2" push -q upstream main

# --- 3.2: .concertino.env carries CONCERTINO_BASE_REMOTE from project.baseRemote --
has "renderEnv writes CONCERTINO_BASE_REMOTE from project.baseRemote" \
    "CONCERTINO_BASE_REMOTE='upstream'" "$PRIMARY2/scripts/concertino/.concertino.env"

# --- 3.1: doctor's Git check reports against the configured remote, not origin ---
OTHER2="$(mktemp -d)"
git clone -q "$REMOTE2" "$OTHER2" 2>/dev/null
git -C "$OTHER2" checkout -q main
git -C "$OTHER2" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "merged PR (configured upstream remote)"
git -C "$OTHER2" push -q origin main
rm -rf "$OTHER2"

node "$ROOT/bin/concertino" doctor --out="$PRIMARY2" > "$OUT" 2>&1
has "reports the commits-behind warning against the configured remote" \
    "1 commit behind upstream/main" "$OUT"
hasnt "does not fall back to origin when a non-default remote is configured" \
    "behind origin/main" "$OUT"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
