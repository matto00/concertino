#!/usr/bin/env bash
# Shell tests for core/scripts/assert-phase.sh's gate.result telemetry
# (duration_ms / first_error). Run: bash test/scripts/assert-phase.test.sh
set -uo pipefail

# See emit-event.test.sh for why this is disabled: FORCE_COLOR would wrap
# node's bare-number output in ANSI codes even off a TTY.
export NO_COLOR=1
unset FORCE_COLOR

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/assert-phase.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Each test runs in a throwaway git repo so emit-event.sh's main-checkout
# resolution is exercised for real, exactly like emit-event.test.sh does.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

echo "assert-phase.sh"

# --- passing phase emits a numeric duration and no first_error -------------
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-1"
mkdir -p "$WT/.git"          # satisfies the "looks like a git worktree" check
OUT="$(cd "$REPO" && "$SCRIPT" setup "$WT")"
RC=$?
LOG="$REPO/.concertino/runs/HEL-1/events.jsonl"
check "exit 0 on pass"          "$RC" "0"
check "stdout is PASS setup"    "$OUT" "PASS setup"
check "emits gate.result"       "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "one gate.result line"    "$(wc -l < "$LOG" | tr -d ' ')" "1"
check "kind is gate.result"     "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).kind)' "$LOG")" "gate.result"
check "status pass"             "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).status)' "$LOG")" "pass"
check "duration_ms is numeric"  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).duration_ms)' "$LOG")" "number"
check "duration_ms non-negative" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).duration_ms >= 0)' "$LOG")" "true"
check "no first_error on pass"  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log("first_error" in JSON.parse(l))' "$LOG")" "false"
rm -rf "$REPO"

# --- failing phase emits a duration and the first failure message ----------
# The setup phase trips two checks in order when the worktree dir is simply
# missing (dir-missing, then not-a-git-worktree) — this doubles as coverage
# for "only the FIRST failure is recorded, not a concatenation of all of them".
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-2"     # deliberately never created
ERR="$(cd "$REPO" && "$SCRIPT" setup "$WT" 2>&1 >/dev/null)"
RC=$?
LOG="$REPO/.concertino/runs/HEL-2/events.jsonl"
check "exit 1 on fail"              "$RC" "1"
check "stderr reports first failure only as FAIL line 1" \
  "$(printf '%s\n' "$ERR" | sed -n '1p')" "FAIL worktree dir missing: $WT"
check "stderr also reports the second failure" \
  "$(printf '%s\n' "$ERR" | sed -n '2p')" "FAIL worktree not a git work tree: $WT"
check "emits gate.result"           "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "status fail"                 "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).status)' "$LOG")" "fail"
check "duration_ms is numeric"      "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).duration_ms)' "$LOG")" "number"
check "first_error is the FIRST failure message" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "worktree dir missing: $WT"
rm -rf "$REPO"

# --- an oversized failure message is trimmed at the source ------------------
REPO="$(new_repo)"
mkdir -p "$REPO/HEL-3" && git -C "$REPO/HEL-3" init -q
LONG_BRANCH="$(head -c 300 /dev/zero | tr '\0' 'b')"
( cd "$REPO" && "$SCRIPT" delivery "$REPO/HEL-3" "$LONG_BRANCH" ) >/dev/null 2>&1
RC=$?
LOG="$REPO/.concertino/runs/HEL-3/events.jsonl"
EXPECTED_MSG="branch ${LONG_BRANCH} not pushed to origin"
check "exit 1 on fail"              "$RC" "1"
check "first_error trimmed to 200 chars" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error.length)' "$LOG")" "200"
check "first_error is a prefix of the untrimmed message" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "${EXPECTED_MSG:0:200}"
rm -rf "$REPO"

# --- sub-second gate reports true millisecond resolution --------------------
# A single run of a near-instant `setup` phase (filesystem stats only) could
# legitimately land exactly on a millisecond tick (duration_ms == 0, itself a
# multiple of 1000) without any bug present — that's a real near-zero
# duration, not a regression. So this samples several runs and only requires
# that NOT ALL of them collapse onto a multiple of 1000: the old
# `date +%s` * 1000 measurement guaranteed a multiple of 1000 on every single
# run, so seeing even one non-multiple proves true ms resolution is in use.
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-4"
mkdir -p "$WT/.git"
SAW_NON_MULTIPLE=no
for _ in $(seq 1 20); do
  (cd "$REPO" && "$SCRIPT" setup "$WT") >/dev/null
  LOG="$REPO/.concertino/runs/HEL-4/events.jsonl"
  D="$(node -e 'const lines=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n");console.log(JSON.parse(lines[lines.length-1]).duration_ms)' "$LOG")"
  if [ "$((D % 1000))" -ne 0 ]; then
    SAW_NON_MULTIPLE=yes
    break
  fi
done
check "sub-second setup run reports true ms resolution (non-1000-multiple duration_ms) within 20 tries" \
  "$SAW_NON_MULTIPLE" "yes"
rm -rf "$REPO"

has()  { grep -qF "$2" "$3" && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt(){ grep -qF "$2" "$3" && bad "$1" "unexpectedly found [$2] in $3" || ok "$1"; }

# =============================================================================
# CON-31: delivery-gate stale-base warning — best-effort, non-blocking.
#
# A bare "remote" plus a worktree checkout cloned from it, mirroring
# cleanup.test.sh's new_pair() shape: the worktree is what assert-phase.sh's
# `delivery` case operates on directly (git -C "$WORKTREE_PATH" ...), so it
# needs its own real `origin` remote to fetch from. The worktree's own path is
# also used as `assert-phase.sh`'s cwd, so emit-event.sh's git-common-dir
# main-checkout resolution has a real repo to resolve (it writes events to
# <that repo>/.concertino/runs/<ticket>/events.jsonl).
# =============================================================================

new_stale_base_pair() {
  local base="$1" branch="$2"
  local remote="$base/remote.git" seed wt="$base/$branch"
  git init -q --bare "$remote"
  seed="$(mktemp -d)"
  git init -q "$seed"
  git -C "$seed" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m init
  git -C "$seed" branch -M main
  git -C "$seed" remote add origin "$remote"
  git -C "$seed" push -q origin main
  rm -rf "$seed"

  git clone -q "$remote" "$wt" 2>/dev/null
  git -C "$wt" -c user.email=t@t.com -c user.name=t checkout -q -b "$branch" main
  git -C "$wt" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "feature work"
  git -C "$wt" push -q origin "HEAD:refs/heads/${branch}"
  printf '%s' "$wt"
}

# Simulates N sibling merges landing on origin/main after the branch above was
# cut, via a separate clone — exactly cleanup.test.sh's advance_remote().
advance_remote_main() {
  local remote="$1" n="$2" other i
  other="$(mktemp -d)"
  git clone -q "$remote" "$other" 2>/dev/null
  git -C "$other" checkout -q main
  for i in $(seq 1 "$n"); do
    git -C "$other" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "sibling merge $i"
  done
  git -C "$other" push -q origin main
  rm -rf "$other"
}

echo "assert-phase.sh delivery (CON-31 stale-base warning)"

# --- base is current: no warning, no telemetry, gate unaffected ------------
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-1")"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-1" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-1/events.jsonl"
check "exit 0 when base current"       "$RC" "0"
check "stdout is PASS delivery"        "$(cat "$OUT")" "PASS delivery"
hasnt "no WARN line when base current" "WARN" "$ERR"
check "only one event (gate.result) when base current" \
  "$([ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0)" "1"
hasnt "no gate.warning kind in log" "gate.warning" "$LOG"
rm -rf "$BASE"

# --- base has moved (3 commits): warning + telemetry, gate still passes ----
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-2")"
advance_remote_main "$BASE/remote.git" 3
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-2" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-2/events.jsonl"
check "exit 0 when base behind"   "$RC" "0"
check "stdout is still PASS delivery" "$(cat "$OUT")" "PASS delivery"
has   "warning names the commit count" "3 commit(s) behind" "$ERR"
has   "warning names the merged commit subject" "sibling merge 3" "$ERR"
has   "warning names the merged commit subject" "sibling merge 1" "$ERR"
has   "gate.warning event emitted" "gate.warning" "$LOG"
check "gate.warning behind=3" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.behind)' "$LOG")" \
  "3"
check "gate.warning gate=phase:delivery" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.gate)' "$LOG")" \
  "phase:delivery"
check "gate.warning base=main" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.base)' "$LOG")" \
  "main"
check "gate.warning remote=origin" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.remote)' "$LOG")" \
  "origin"
check "gate.warning commits lists 3 short SHAs" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.commits.split(",").length)' "$LOG")" \
  "3"
has "gate.result still recorded alongside gate.warning" "gate.result" "$LOG"
rm -rf "$BASE"

# --- base has moved by more than 5 commits: list capped, "+N more" shown ---
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-3")"
advance_remote_main "$BASE/remote.git" 12
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-3" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-3/events.jsonl"
check "exit 0 when far behind" "$RC" "0"
check "stdout is still PASS delivery (far behind)" "$(cat "$OUT")" "PASS delivery"
has "warning names the true total count (12)" "12 commit(s) behind" "$ERR"
has "warning appends the +N more suffix" "(+7 more)" "$ERR"
check "warning lists at most 5 commit lines" \
  "$(grep -c 'sibling merge' "$ERR")" "5"
check "gate.warning behind=12" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.behind)' "$LOG")" \
  "12"
check "gate.warning commits capped at 5 short SHAs" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).find(e=>e.kind==="gate.warning");console.log(l.commits.split(",").length)' "$LOG")" \
  "5"
rm -rf "$BASE"

# --- fetch fails (remote unreachable): silent skip, gate unaffected --------
# refs/remotes/origin/<branch> (the pushed-branch check) and the clean-tree
# check both read local state only, so pointing origin at a now-nonexistent
# path after the initial clone/push leaves the gate's existing pass/fail
# checks untouched — only this new best-effort fetch is affected.
BASE="$(mktemp -d)"
WT="$(new_stale_base_pair "$BASE" "TICK-4")"
rm -rf "$BASE/remote.git"          # origin now points at a nonexistent path
git -C "$WT" remote set-url origin "$BASE/remote.git"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
( cd "$WT" && "$SCRIPT" delivery "$WT" "TICK-4" ) >"$OUT" 2>"$ERR"
RC=$?
LOG="$WT/.concertino/runs/TICK-4/events.jsonl"
check "exit 0 when fetch fails"        "$RC" "0"
check "stdout is still PASS delivery (fetch fails)" "$(cat "$OUT")" "PASS delivery"
hasnt "no WARN line when fetch fails" "WARN" "$ERR"
hasnt "no gate.warning kind when fetch fails" "gate.warning" "$LOG"
check "only one event (gate.result) when fetch fails" \
  "$([ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0)" "1"
rm -rf "$BASE"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
