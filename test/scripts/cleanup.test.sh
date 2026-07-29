#!/usr/bin/env bash
# cleanup.sh's fast-forward step (CON-25): a clean, unambiguous fast-forward
# proceeds silently — via `git update-ref` when <base> isn't checked out
# anywhere, via `git merge --ff-only` when it is and the tree is clean.
# Anything else (a dirty tree, a diverged base) must change NOTHING and
# escalate instead. Whatever happens, `cleanup.sh --phase4` must still exit 0
# and print its normal `READY cleaned worktree=...` line — a stale base is a
# risk for the NEXT run, never a reason to leave THIS teardown incomplete.
set -uo pipefail

# See escalation-loop.test.sh's identical note: some shells export
# FORCE_COLOR, which makes node wrap bare output in ANSI codes even off a TTY.
export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLEANUP="$ROOT/core/scripts/cleanup.sh"
EMIT="$ROOT/core/scripts/emit-event.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { grep -qF "$2" "$3" && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt(){ grep -qF "$2" "$3" && bad "$1" "unexpectedly found [$2] in $3" || ok "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "cleanup.sh (fast-forward local main)"

write_answer() {
  # Exercises the actual writer, exactly as the dashboard (or its new banner —
  # CON-25) would after a human answers.
  node -e '
    const store = require(process.argv[1]);
    store.writeAnswer(process.argv[2], process.argv[3], process.argv[4]);
  ' "$ROOT/lib/ui/store.js" "$1" "$2" "$3"
}

wait_for_escalation() {
  local log="$1"
  for _ in $(seq 1 100); do
    [ -f "$log" ] && grep -q escalation.raised "$log" 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}

# A bare "remote" plus a "primary" checkout cloned from it, with cleanup.sh
# and emit-event.sh vendored in and COMMITTED — an uncommitted copy would
# itself register as the "dirty tree" this whole suite exercises.
new_pair() {
  local base="$1"
  local remote="$base/remote.git" primary="$base/primary"
  git init -q --bare "$remote"
  git clone -q "$remote" "$primary" 2>/dev/null
  mkdir -p "$primary/scripts/concertino"
  cp "$CLEANUP" "$primary/scripts/concertino/cleanup.sh"
  cp "$EMIT" "$primary/scripts/concertino/emit-event.sh"
  chmod +x "$primary/scripts/concertino/"*.sh
  # .concertino/ (the run log emit-event.sh --await writes to) must be
  # gitignored here exactly as it is in the real project — otherwise the
  # escalation this suite itself raises would register as its own "dirty
  # tree", corrupting the very check under test.
  echo ".concertino/" > "$primary/.gitignore"
  echo "hello" > "$primary/file.txt"
  git -C "$primary" add -A
  git -C "$primary" -c user.email=t@t.com -c user.name=t commit -q -m init
  git -C "$primary" branch -M main
  git -C "$primary" push -q origin main
}

# A separate clone pushes one more commit to origin/main — simulating a PR
# merge that landed while the primary checkout wasn't looking.
advance_remote() {
  local remote="$1" other
  other="$(mktemp -d)"
  git clone -q "$remote" "$other" 2>/dev/null
  git -C "$other" checkout -q main
  git -C "$other" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "merged PR"
  git -C "$other" push -q origin main
  rm -rf "$other"
}

run_cleanup() {
  local primary="$1" wt="$2" out="$3" err="$4"
  ( cd "$primary" && bash scripts/concertino/cleanup.sh --phase4 "$wt" "" "" ) > "$out" 2> "$err"
}

# --- already current: silent no-op ------------------------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
WT="$BASE/TICK-1"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
check "exits 0 when already current"        "$?"   "0"
has   "prints READY when already current"   "READY cleaned worktree=" "$OUT"
hasnt "no note when already current"        "note:" "$ERR"
rm -rf "$BASE"

# --- not checked out anywhere: silent update-ref ----------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
git -C "$BASE/primary" checkout -q -b scratch
advance_remote "$BASE/remote.git"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse refs/heads/main)"
WT="$BASE/TICK-2"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
RC=$?
check "exits 0 (update-ref path)" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse refs/heads/main)"
REMOTE_MAIN="$(git -C "$BASE/primary" rev-parse origin/main)"
check "local main advanced via update-ref to the fetched remote tip" "$AFTER_MAIN" "$REMOTE_MAIN"
[ "$AFTER_MAIN" != "$BEFORE_MAIN" ] && ok "local main actually moved" || bad "local main actually moved" "still $BEFORE_MAIN"
check "the checked-out branch (scratch) is untouched" "$(git -C "$BASE/primary" symbolic-ref --short HEAD)" "scratch"
has "prints READY (update-ref path)" "READY cleaned worktree=" "$OUT"
hasnt "no escalation note (update-ref path)" "note: local" "$ERR"
rm -rf "$BASE"

# --- checked out and clean: silent merge --ff-only --------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
WT="$BASE/TICK-3"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR"
RC=$?
check "exits 0 (merge --ff-only path)" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
REMOTE_MAIN="$(git -C "$BASE/primary" rev-parse origin/main)"
check "local main fast-forwarded via merge --ff-only" "$AFTER_MAIN" "$REMOTE_MAIN"
has "prints READY (merge --ff-only path)" "READY cleaned worktree=" "$OUT"
hasnt "no escalation note (merge --ff-only path)" "note: local" "$ERR"
rm -rf "$BASE"

# --- dirty tree: escalates, changes nothing, skip leaves it untouched -------
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
echo "uncommitted local edit" >> "$BASE/primary/file.txt"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse main)"
WT="$BASE/TICK-4"
LOG="$BASE/primary/.concertino/runs/TICK-4/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "dirty tree raises an escalation" || bad "dirty tree raises an escalation" "escalation.raised never landed"
write_answer "$BASE/primary" TICK-4 skip
wait "$CPID"; RC=$?
check "exits 0 after a dirty-tree escalation is skipped" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
check "local main is untouched (dirty tree)" "$AFTER_MAIN" "$BEFORE_MAIN"
grep -q "uncommitted local edit" "$BASE/primary/file.txt" && ok "the uncommitted edit itself is untouched" || bad "the uncommitted edit itself is untouched" "edit vanished"
has "prints READY despite a dirty-tree escalation" "READY cleaned worktree=" "$OUT"
[ -f "$LOG" ] && grep -q escalation.answered "$LOG" && ok "the answered escalation is logged" || bad "the answered escalation is logged" "no escalation.answered"
rm -rf "$BASE"

# --- diverged base: escalates, changes nothing -------------------------------
BASE="$(mktemp -d)"; new_pair "$BASE"
git -C "$BASE/primary" -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m "a local commit origin doesn't have"
BEFORE_MAIN="$(git -C "$BASE/primary" rev-parse main)"
WT="$BASE/TICK-5"
LOG="$BASE/primary/.concertino/runs/TICK-5/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "a diverged base raises an escalation" || bad "a diverged base raises an escalation" "escalation.raised never landed"
write_answer "$BASE/primary" TICK-5 skip
wait "$CPID"; RC=$?
check "exits 0 after a diverged-base escalation is skipped" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
check "local main is untouched (diverged)" "$AFTER_MAIN" "$BEFORE_MAIN"
has "prints READY despite a diverged-base escalation" "READY cleaned worktree=" "$OUT"
rm -rf "$BASE"

# --- retry: a second attempt that now resolves cleanly succeeds -------------
BASE="$(mktemp -d)"; new_pair "$BASE"
advance_remote "$BASE/remote.git"
echo "uncommitted local edit" >> "$BASE/primary/file.txt"
WT="$BASE/TICK-6"
LOG="$BASE/primary/.concertino/runs/TICK-6/events.jsonl"
OUT="$BASE/out.txt"; ERR="$BASE/err.txt"
run_cleanup "$BASE/primary" "$WT" "$OUT" "$ERR" &
CPID=$!
wait_for_escalation "$LOG" && ok "retry scenario: the first attempt raises an escalation" \
  || bad "retry scenario: the first attempt raises an escalation" "escalation.raised never landed"
# The human "stashes" the offending edit out of band, then answers retry.
git -C "$BASE/primary" checkout -q -- file.txt
write_answer "$BASE/primary" TICK-6 retry
wait "$CPID"; RC=$?
check "exits 0 after a successful retry" "$RC" "0"
AFTER_MAIN="$(git -C "$BASE/primary" rev-parse main)"
REMOTE_MAIN="$(git -C "$BASE/primary" rev-parse origin/main)"
check "local main fast-forwarded on the retried attempt" "$AFTER_MAIN" "$REMOTE_MAIN"
has "prints READY after a successful retry" "READY cleaned worktree=" "$OUT"
hasnt "no 'remains behind' note after a successful retry" "remains behind" "$ERR"
rm -rf "$BASE"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
